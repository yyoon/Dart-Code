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

	private organizeDirectives(editor: vs.TextEditor, editBuilder: vs.TextEditorEdit) {
		if (!editors.hasActiveDartEditor()) {
			vs.window.showWarningMessage("No active Dart editor.");
			return;
		}

		this.analyzer.editOrganizeDirectives({ file: editor.document.fileName }).then((response) => {
			let edit: as.SourceFileEdit = response.edit;
			if (edit.edits.length == 0)
				return;

			editor.edit((editBuilder: vs.TextEditorEdit) => {
				edit.edits.forEach((edit) => {
					let range = new vs.Range(
						editor.document.positionAt(edit.offset),
						editor.document.positionAt(edit.offset + edit.length)
					);
					editBuilder.replace(range, edit.replacement);
				});
			}).then((result) => {
				if (!result)
					vs.window.showWarningMessage("Unable to apply organize directives edits.");
			});
		}, (error) => {
			vs.window.showErrorMessage(`Error running organize directives: ${error.message}.`);
		});
	}

	dispose(): any {
		for (let command of this.commands)
			command.dispose();
	}

	private applyEdits(document: vs.TextDocument, change: as.SourceChange) {
		// We can only apply with snippets if there's a single change.
		if (change.edits.length == 1 && change.linkedEditGroups != null && change.linkedEditGroups.length != 0)
			return this.applyEditsWithSnippets(document, change);

		// Otherwise, just make all the edits without the snippets.
		let changes = new vs.WorkspaceEdit();

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
		vs.workspace.applyEdit(changes).then(success => {
			// Set the cursor position.
			if (change.selection) {
				let pos = document.positionAt(change.selection.offset);
				let selection = new vs.Selection(pos, pos);
				vs.window.showTextDocument(document).then(ed => ed.selection = selection);
			}
		});
	}

	private applyEditsWithSnippets(document: vs.TextDocument, change: as.SourceChange) {
		const edit = change.edits[0];
		vs.window.showTextDocument(document).then(editor => {
			// Apply of all of the edits.
			editor.edit(eb => {
				edit.edits.forEach(e => {
					eb.replace(
						new vs.Range(document.positionAt(e.offset), document.positionAt(e.offset + e.length)),
						e.replacement
					);
				});
			}).then(_ => {
				const documentText = editor.document.getText();

				// Create a list of all the placeholders.
				const placeholders: { offset: number, length: number, value: string, placeholderNumber: number }[] = [];
				let num = 1;
				change.linkedEditGroups.forEach(leg => {
					leg.positions.forEach(pos => {
						placeholders.push({ offset: pos.offset, length: leg.length, value: documentText.substr(pos.offset, leg.length), placeholderNumber: num });
					});
					num++;
				});

				// Ensure they're in offset order so the next maths works!			
				placeholders.sort((p1, p2) => p1.offset - p2.offset);

				const snippet = new vs.SnippetString();
				let currentPos = 0;
				placeholders.forEach(p => {
					// Add the text from where we last were up to current placeholder.
					snippet.appendText(documentText.substring(currentPos, p.offset));
					// Add the placeholder.
					snippet.appendPlaceholder(p.value, p.placeholderNumber);
					currentPos = p.offset + p.length;
				});
				// Add any remaining text.
				snippet.appendText(documentText.substring(currentPos));
				// And put a tabstop at the end.
				snippet.appendTabstop(num);

				// Replace the document.				
				editor.insertSnippet(snippet, new vs.Range(document.positionAt(0), document.positionAt(documentText.length)));
			});
		});
	}
}
