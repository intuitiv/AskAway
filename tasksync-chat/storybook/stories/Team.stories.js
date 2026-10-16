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
	name: '4. MemberEdit (OpenCode + agy Model Dropdown & Effort)',
	render: () => mountTeamStory({
		scenario: 'member-edit',
		editingMemberId: 'diego',
		modelDropdownOpen: true,
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
