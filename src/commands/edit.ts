"use strict";

import * as as from "../analysis/analysis_server_types";
import * as editors from "../editors";
import * as vs from "vscode";
import { Analyzer } from "../analysis/analyzer";

export class EditCommands implements vs.Disposable {
	private context: vs.ExtensionContext;
	private analyzer: Analyzer;
	private commands: Array<vs.Disposable> = [];

	constructor(context: vs.ExtensionContext, analyzer: Analyzer) {
		this.context = context;
		this.analyzer = analyzer;

		this.commands.push(
			vs.commands.registerTextEditorCommand("dart.organizeDirectives", this.organizeDirectives, this),
			vs.commands.registerCommand("dart.applySourceChange", this.applyEdits, this)
		);
	}

	private async organizeDirectives(editor: vs.TextEditor, editBuilder: vs.TextEditorEdit) {
		if (!editors.hasActiveDartEditor()) {
			vs.window.showWarningMessage("No active Dart editor.");
			return;
		}

		let response: as.EditOrganizeDirectivesResponse;
		try {
			response = await this.analyzer.editOrganizeDirectives({ file: editor.document.fileName });
		}
		catch (error) {
			vs.window.showErrorMessage(`Error running organize directives: ${error.message}.`);
			return;
		}

		let edit: as.SourceFileEdit = response.edit;
		if (edit.edits.length == 0)
			return;

		const result = await editor.edit((editBuilder: vs.TextEditorEdit) => {
			edit.edits.forEach((edit) => {
				let range = new vs.Range(
					editor.document.positionAt(edit.offset),
					editor.document.positionAt(edit.offset + edit.length)
				);
				editBuilder.replace(range, edit.replacement);
			});
		});

		if (!result)
			vs.window.showWarningMessage("Unable to apply organize directives edits.");

	}

	dispose(): any {
		for (let command of this.commands)
			command.dispose();
	}

	private async applyEdits(document: vs.TextDocument, change: as.SourceChange) {
		const changes = new vs.WorkspaceEdit();

		// Build a list of changes.		
		change.edits.forEach(edit => {
			edit.edits.forEach(e => {
				changes.replace(
					vs.Uri.file(edit.file),
					new vs.Range(
						document.positionAt(e.offset),
						document.positionAt(e.offset + e.length)
					),
					e.replacement
				)
			})
		});

		// Apply the edits.		
		await vs.workspace.applyEdit(changes);

		// Set the cursor position.
		if (change.selection) {
			const editor = await vs.window.showTextDocument(document);
			const pos = document.positionAt(change.selection.offset);
			editor.selection = new vs.Selection(pos, pos);
		}
	}
}
