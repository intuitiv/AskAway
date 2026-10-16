const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const esbuild = require('esbuild');
(async () => {
    const code = esbuild.buildSync({ stdin: { contents: "export * from './src/aitalk/store'; export * from './src/aitalk/actors'; export * from './src/aitalk/delivery'; export * from './src/aitalk/validatorDelivery'; export * from './src/commentary/commentary'; export * from './src/workers/workerTools';", resolveDir: __dirname }, bundle: true, platform: 'node', format: 'cjs', write: false }).outputFiles[0].text;
    const mod = { exports: {} }; new Function('require', 'module', 'exports', code)(require, mod, mod.exports);
    const api = mod.exports;
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aitalk-actors-')));
    const room = api.roomFor(root);
    const find = id => room.store.snapshot(true).messages.find(item => item.id === id);
    const member = id => room.store.snapshot().members.find(item => item.id === id);
    const flush = () => new Promise(resolve => setImmediate(resolve));
    const provider = fs.readFileSync(path.join(__dirname, 'src/webview/webviewProvider.ts'), 'utf8');
    assert.equal(provider.replace(/\r\n/g, '').includes('\n'), false, 'provider keeps CRLF');
    const native = provider.slice(provider.indexOf('                    if (!isChildLog && line.indexOf'), provider.indexOf('                    // ── Sub-agent linkage:'));
    const nativeStart = require('typescript').transpileModule(`function submit(lines, isChildLog = false, lineIndexBase = 0) { const logFile = 'main.jsonl'; for (const [i, line] of lines.entries()) { const lineIndex = lineIndexBase + i; ${native} } }`, { compilerOptions: { target: 9 } }).outputText;
    let starts = 0;
    const onSubmit = require('node:vm').runInNewContext(nativeStart + ';submit');
    let submittedText;
    const receiver = { _logTurnStartTs: 0, _replayFloors: new Map(), _resetTurnMetrics() {}, _validatorTurnStart(text) { submittedText = text; starts++; room.registerAgent(); } };
    const line = JSON.stringify({ type: 'user_message', ts: Date.now(), attrs: { text: 'Start now' } });
    onSubmit.call(receiver, [line, line]);
    assert.equal(member('agent').presence, 'joined', 'native submit joins immediately without a tool or commentary');
    assert.equal(starts, 1, 'one registration callback per native turn');
    assert.equal(submittedText, 'Start now', 'native attrs.text reaches the turn callback');
    assert.equal(room.snapshot().messages.filter(m => m.text === 'Agent joined').length, 1);
    room.unregisterAgent();
    receiver._logTurnStartTs = 0;
    receiver._replayFloors.set('main.jsonl', 2);
    onSubmit.call(receiver, [line]);
    assert.equal(member('agent').presence, 'left', 'reload replay of a completed turn must not rejoin Agent');
    assert.equal(starts, 1, 'replay does not call the turn-start lifecycle');
    console.log('PASS EV-AITALK-NATIVE-START native user_message joins Agent immediately once with banner');

    const typingActor = room.register({ id: 'typing-validator', kind: 'navigator', displayName: 'Typing Validator', rank: 300 });
    const reader = new api.Room(root);
    typingActor.typing(true);
    assert.equal(reader.snapshot().typing, 'Typing Validator is typing…', 'typing crosses room/store instances');
    // Production and Storybook consume this same snapshot renderer.
    const renderTyping = await import('./media/aitalk/talkRender.js');
    assert.match(renderTyping.talkHtml([], reader.snapshot()), /talk-typing/);
    typingActor.post('Ready');
    assert.equal(reader.snapshot().typing, '', 'posting the reply clears persisted typing');
    typingActor.typing(true);
    const clock = Date.now; Date.now = () => clock() + 90001;
    try { assert.equal(reader.snapshot().typing, '', 'abandoned typing expires'); } finally { Date.now = clock; }
    typingActor.unregister();
    console.log('PASS EV-AITALK-SHARED-TYPING shared typing renders across instances, clears on reply and expires');

    // Registration: join/leave banners; an unregistered actor cannot post.
    assert.throws(() => room.post('agent', 'progress'), /not registered/);
    const received = [];
    const sage = room.register({ id: 'sage', displayName: 'Sage', kind: 'navigator', rank: 250,
        receive: (message, tracker) => { received.push(['receive', message.text]); tracker.delivered(); },
        receiveReply: (original, reply, tracker) => { received.push(['reply', original.text, reply.text]); tracker.delivered(); tracker.read(); },
        receiveReaction: (message, emoji, by) => received.push(['reaction', message.text, emoji, by]) });
    assert.equal(member('sage').presence, 'joined');
    assert.ok(room.store.snapshot().messages.some(item => item.kind === 'system' && item.text === 'Sage joined'));

    // Validator actor with a stub model: answers what is routed to it, in-thread.
    const asked = [];
    const validator = api.registerAITalkValidator(root, async (text, id) => { asked.push(text); room.post('validator', `Answer to ${id}`, { replyTo: id }); return { answer: 'stub' }; });

    // Routing: @tag → that actor; reply → owner; direct → Validator.
    const tagged = room.userPost('@Sage route this?');
    assert.deepEqual(tagged.message.recipients, ['sage']); assert.deepEqual(received.at(-1), ['receive', '@Sage route this?']);
    assert.equal(find(tagged.message.id).tick, 'delivered', 'the receiving actor drives the tracker');
    const sageQuestion = sage.post('Which branch?').message;
    assert.equal(find(sageQuestion.id).tick, undefined, 'actor messages never carry ticks');
    const replied = room.userPost('main', sageQuestion.id);
    assert.deepEqual(replied.message.recipients, ['sage']); assert.deepEqual(received.at(-1), ['reply', 'Which branch?', 'main']);
    assert.equal(find(replied.message.id).tick, 'read');
    const direct = room.userPost('Should we ship today?');
    assert.deepEqual(direct.message.recipients, ['validator']);
    assert.equal(find(direct.message.id).tick, 'sent');
    await validator.flush(); await flush();
    assert.equal(find(direct.message.id).tick, 'read', 'Validator: delivered when invoked, read when answered');
    assert.ok(room.store.snapshot().messages.some(item => item.author === 'validator' && item.replyTo === direct.message.id));
    assert.equal(room.store.snapshot().messages.filter(item => item.author !== 'you' && item.tick).length, 0, 'ticks only on user messages');

    // Reactions reach the message owner.
    room.react('you', sageQuestion.id, '👍');
    assert.deepEqual(received.at(-1), ['reaction', 'Which branch?', '👍', 'you']);

    // Agent: registers with its first tool call of the turn; its @Validator message gets an answer.
    api.configureAITalkDelivery(root); api.setToolResultDelivery(api.appendAITalkDelivery);
    const { z } = require('zod');
    await api.invokeDefinition({ name: 'any-tool', inputSchema: z.object({}), run: () => ({ status: 'ok' }) }, {});
    assert.equal(member('agent').presence, 'joined', 'Agent registers when its turn runs');
    const agentAsk = room.post('agent', '@Validator is green allowed?').message;
    await validator.flush();
    assert.ok(room.store.snapshot().messages.some(item => item.author === 'validator' && item.replyTo === agentAsk.id), 'Agent @Validator is answered');
    assert.equal(find(agentAsk.id).tick, undefined);

    // askaway_validator: the Agent's question is visible and the answer replies to it.
    room.unregisterAgent();
    const result = await api.askValidator(root, 'Hold or ship the five decisions?');
    assert.deepEqual(result, { answer: 'stub' });
    const question = room.store.snapshot().messages.find(item => item.author === 'agent' && item.text === '@Validator Hold or ship the five decisions?');
    assert.ok(question, 'the question is posted as an Agent message @Validator');
    assert.ok(room.store.snapshot().messages.some(item => item.author === 'validator' && item.replyTo === question.id));
    assert.equal(member('agent').presence, 'joined', 'Agent is a participant whenever it posts');

    room.unregisterAgent();
    const commentary = api.commentaryToolDefinitions(() => new api.CommentaryStore(), root)[0];
    const mcpPost = api.withAITalkMcpDelivery(async args => ({ content: [{ type: 'text', text: JSON.stringify(commentary.run(args)) }] }), root);
    await mcpPost({ action: 'aitalk', workspacePath: root, text: '@Validator Is this MCP question visible?' }, { _meta: { recipient: 'agent', workspacePath: root } });
    const mcpQuestion = room.snapshot().messages.find(m => m.author === 'agent' && m.text === '@Validator Is this MCP question visible?');
    assert.ok(mcpQuestion, 'explicit main-agent MCP caller posts its question before the answer');
    await validator.flush();
    assert.ok(room.snapshot().messages.some(m => m.author === 'validator' && m.replyTo === mcpQuestion.id && m.quote.text === mcpQuestion.text));
    console.log('PASS EV-AITALK-MCP-QUESTION main-agent MCP question is visible with quoted Validator reply');

    // Workers: unknown until they post; leave when every message they posted is answered.
    room.workerLifecycle({ id: 'w-1', displayName: 'build' }, true);
    assert.equal(member('w-1'), undefined);
    const first = room.workerPost('w-1', 'Question one?').message;
    const second = room.workerPost('w-1', 'Question two?').message;
    assert.equal(member('w-1').presence, 'joined'); assert.equal(member('w-1').displayName, 'build · w-1');
    room.userPost('one', first.id); assert.equal(member('w-1').presence, 'joined');
    room.userPost('two', second.id); assert.equal(member('w-1').presence, 'left');
    assert.ok(room.store.snapshot().messages.some(item => item.kind === 'system' && item.text === 'build · w-1 left'));
    assert.throws(() => room.post('w-1', 'late'), /not registered/);
    console.log('PASS EV-AITALK-ACTORS routing tag/reply/direct→Validator; receiving actor drives ticks on user messages only; register/unregister banners; unregistered cannot post; Agent registers on turn tool call; Validator answers user and Agent @Validator; askaway_validator question visible; worker joins on post, leaves when answered');

    // Widget: safe markdown for bodies and Read more.
    const render = await import('./media/aitalk/talkRender.js');
    const md = render.bodyHtml({ id: 'm', author: 'agent', text: '**Bold** and `code`\n- one\n- two\n[docs](https://example.invalid/a?b=1&c=2) [x](javascript:alert(1)) <img src=x onerror=alert(1)>', expanded: true });
    assert.match(md, /<strong>Bold<\/strong>/); assert.match(md, /<code>code<\/code>/); assert.match(md, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
    assert.match(md, /<a href="https:\/\/example.invalid\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">docs<\/a>/);
    assert.doesNotMatch(md, /<img|href="javascript|<a href="javascript/); assert.match(md, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(render.detailsHtml('Pick **B**\n```\n<b>raw</b>\n```'), /<p>Pick <strong>B<\/strong><\/p><pre><code>&lt;b&gt;raw&lt;\/b&gt;<\/code><\/pre>/);
    console.log('PASS EV-AITALK-MARKDOWN one safe renderer for bodies and Read more; XSS escaped; http(s) links only');

    // Widget: snapshot updates patch regions; an open avatar menu is never re-mounted.
    const { createTalkController } = await import('./media/aitalk/talkController.js');
    const handlers = {};
    const events = { addEventListener(name, fn) { (handlers[name] ||= []).push(fn); } };
    let mounts = 0, regions = {};
    const textarea = { value: '', matches: () => true, focus() {}, setSelectionRange() {} };
    const host = {
        contains: () => true, querySelectorAll: () => [],
        set innerHTML(html) { mounts++; regions = {}; for (const match of html.matchAll(/data-talk-region="(\w+)"/g)) regions[match[1]] = { dataset: { talkRegion: match[1] }, writes: 0, html: '', set innerHTML(value) { this.writes++; this.html = value; }, get innerHTML() { return this.html; } }; },
        querySelector(selector) { const key = selector.match(/data-talk-region="(\w+)"/)?.[1]; if (key) return regions[key]; if (selector === 'textarea') return textarea; if (selector === '.talk-thread') return regions.thread; return null; },
    };
    const controller = createTalkController({ host, events, post: () => {} });
    const members = [{ id: 'you', kind: 'user', displayName: 'You', rank: 400, presence: 'joined' }, { id: 'agent', kind: 'agent', displayName: 'Agent', rank: 200, presence: 'joined' }];
    controller.render({ members, messages: [{ id: 'a1', author: 'agent', text: 'Working' }] });
    assert.equal(mounts, 1);
    const trigger = { closest: selector => selector.includes('presence-trigger') || selector === '.presence-anchor' ? trigger : null, classList: { contains: name => name === 'presence-trigger' } };
    for (const handler of handlers.click) handler({ target: trigger });
    assert.match(regions.presence.html, /presence-flyout/); const opened = regions.presence.writes;
    for (let poll = 0; poll < 3; poll++) controller.render({ members, typing: poll === 1 ? 'Agent is typing…' : '', messages: [{ id: 'a1', author: 'agent', text: 'Working' }, ...(poll ? [{ id: 'a2', author: 'agent', text: 'Still working' }] : [])] });
    assert.equal(mounts, 1, 'snapshots never re-mount the widget');
    assert.equal(regions.presence.writes, opened, 'the open avatar menu is not re-rendered by snapshots');
    assert.match(regions.thread.html, /Still working/);
    console.log('PASS EV-AITALK-WIDGET-STABLE open avatar menu survives periodic snapshots; only changed regions patch');

    // Widget driven by simulated actors (hard-coded script): same widget code as production.
    const { createSimulatedRoom } = await import('./storybook/prototypes/simulatedActors.js');
    const shown = { html: '' };
    const simHost = { innerHTML: '', querySelector: selector => selector === 'textarea' ? textarea : null };
    const intents = [];
    const widget = createTalkController({ host: simHost, events: { addEventListener() {} }, post: action => { intents.push(action); simulated.intent(action); } });
    const later = [];
    const simulated = createSimulatedRoom({ members: [...members.slice(0, 1), { id: 'agent', kind: 'agent', displayName: 'Agent', rank: 200, presence: 'left' }], render: state => widget.render(state), schedule: fn => later.push(fn) });
    simulated.start();
    for (const step of [{ do: 'join', who: 'agent' }, { do: 'typing', who: 'Agent is typing…' }, { do: 'add', message: { id: 's1', author: 'agent', text: '**Ready**' } }]) simulated.act(step);
    assert.match(simHost.innerHTML, /Agent joined/); assert.match(simHost.innerHTML, /<strong>Ready<\/strong>/);
    simulated.intent({ type: 'aitalkPost', text: '@Agent go' });
    assert.match(simHost.innerHTML, /talk-ticks posted/);
    later.shift()(); assert.match(simHost.innerHTML, /talk-ticks delivered/);
    later.shift()(); assert.match(simHost.innerHTML, /talk-ticks read/);
    assert.equal((simHost.innerHTML.match(/talk-ticks/g) || []).length, 1, 'only the user message has ticks');
    simulated.act({ do: 'leave', who: 'agent' }); assert.match(simHost.innerHTML, /Agent left/);
    console.log('PASS EV-AITALK-WIDGET-SIMULATED scripted actors join, type, post markdown, tick the user message and leave through the shared widget');
})().catch(error => { console.error(error); process.exitCode = 1; });
