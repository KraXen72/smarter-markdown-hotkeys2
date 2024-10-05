import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { TextTransformer } from './engine';

// Remember to rename these classes and interfaces!

interface SmarterHotkeysSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: SmarterHotkeysSettings = {
	mySetting: 'default'
}

export const TextTransformOperations = {
	bold: "**",
	highlight: "==",
	italics: "*",
	inlineCode: "`",
	comment: "%%",
	strikethrough: "~~"
} as const;
export type ValidOperations = keyof typeof TextTransformOperations;
export type validOperationMarkers = typeof TextTransformOperations[ValidOperations];

export default class SmarterHotkeys extends Plugin {
	settings: SmarterHotkeysSettings;
	engine: TextTransformer;

	async onload() {
		await this.loadSettings();
		this.engine = new TextTransformer();

		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'smarter-bold2',
			name: 'Bold2',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				this.engine.setEditor(editor);
				this.engine.transformText("bold");
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: SmarterHotkeys;

	constructor(app: App, plugin: SmarterHotkeys) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
