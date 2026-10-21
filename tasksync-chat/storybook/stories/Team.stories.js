import { mountTeamStory } from '../prototypes/team.js';

export default {
	title: 'AITalk/Team tab',
	parameters: {
		layout: 'centered',
		backgrounds: { default: 'dark' },
	},
};

export const ActiveTurn = {
	name: '1. ActiveTurn (~40s Live Timeline)',
	args: {
		activeTab: 'aitalk',
	},
	argTypes: {
		activeTab: {
			control: { type: 'inline-radio' },
			options: ['aitalk', 'team'],
		},
	},
	render: (args = {}) => mountTeamStory({
		scenario: 'active-turn',
		initialStep: 0,
		liveScript: true,
		activeTab: args.activeTab || 'aitalk',
	}),
};

export const OrchestratorSelected = {
	name: '2. OrchestratorSelected (AA.Orchestrator → Mahesh)',
	render: () => mountTeamStory({
		scenario: 'orchestrator',
		selectedAgent: 'AA.Orchestrator',
	}),
};

export const UnknownAgent = {
	name: '3. UnknownAgent (Custom.Planner → Actual Name + Initials)',
	render: () => mountTeamStory({
		scenario: 'unknown-agent',
		selectedAgent: 'Custom.Planner',
	}),
};

export const MemberEdit = {
	name: '4. MemberEdit (Profile: Name, Role, Status, Picture)',
	render: () => mountTeamStory({
		scenario: 'member-edit',
		editingMemberId: 'diego',
	}),
};

export const NameClickOpensProfile = {
	name: '5. NameClickOpensProfile (Click @Priya → Team Row Highlighted)',
	render: () => mountTeamStory({
		scenario: 'name-click',
		clickedMemberId: 'priya',
	}),
};

export const LightTheme = {
	name: '6. LightTheme ([data-theme="light"])',
	parameters: {
		backgrounds: { default: 'light' },
	},
	render: () => mountTeamStory({
		scenario: 'light',
		theme: 'light',
	}),
};

// Compact Team rows (prototype; production Team keeps the full rows). Collapsed by default, the pencil Edit button opens one panel with everything editable.
export const Compact = {
	name: '7. Compact (accent colours, share bars, rotating status, health strip)',
	render: () => mountTeamStory({ scenario: 'compact' }),
};

export const EditOpen = {
	name: '8. EditOpen (Anika: name, role, picture, Model, Thinking, Agent file, Reset)',
	render: () => mountTeamStory({ scenario: 'edit-open' }),
};

export const EmptyTurn = {
	name: '9. EmptyTurn (only Priya and Bhaskar: "No workers have spent this turn.")',
	render: () => mountTeamStory({ scenario: 'empty-turn' }),
};

export const CompactLight = {
	name: '10. CompactLight ([data-theme="light"])',
	parameters: {
		backgrounds: { default: 'light' },
	},
	render: () => mountTeamStory({ scenario: 'compact', theme: 'light' }),
};

export const ShowAll = {
	name: '11. ShowAll (toggle on: passive Diego, Pavel, Sana, Shreya, Cathy at $0)',
	render: () => mountTeamStory({ scenario: 'show-all' }),
};
