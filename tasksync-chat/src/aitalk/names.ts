import { TEAM_ROSTER, resolveMainAgentIdentity } from '../team/roster';
import * as os from 'os';

export function rosterIdentity(actor: any, selectedAgent = 'AskAway Build'): any {
    const keys = [actor.memberId, actor.id, actor.name, actor.displayName, actor.profile].filter(Boolean).map((value: string) => value.toLowerCase().split(' · ')[0]);
    const member = TEAM_ROSTER.find(item => keys.includes(item.id))
        || (actor.kind === 'agent' ? resolveMainAgentIdentity(selectedAgent) : undefined)
        || TEAM_ROSTER.find(item => keys.some((key: string) => [item.name, ...item.profiles].some(value => value.toLowerCase() === key)))
        || (actor.kind === 'worker' && keys.some((key: string) => /^(worker-|worker$)/.test(key)) ? TEAM_ROSTER.find(item => item.id === 'diego') : undefined);
    if (actor.kind === 'user') {
        const name = [actor.name, actor.displayName].find(value => value && !/^(you|cpo|reviewer)$/i.test(value)) || os.userInfo().username;
        return { ...actor, name, displayName: name };
    }
    if (!member) return actor;
    return { ...actor, memberId: member.id, name: member.name, displayName: actor.displayName || member.name, role: member.role };
}
