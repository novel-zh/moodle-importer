# Setup and operation

## 1. Moodle plugin

The plugin component is `local_formsquiz`, release 0.3.0, for Moodle 4.3.x.
Copy `moodle/local/formsquiz` into your Moodle checkout as `local/formsquiz`, then
complete the administrator upgrade flow. For the plugin installer, create a ZIP
whose top-level directory is `formsquiz/`; do not upload a ZIP of this entire repository.
PHP ZIP support is required for package import.

Open Site administration → Plugins → Local plugins, or `/local/formsquiz/index.php`.
The page requires site configuration capability.

## 2. Google Apps Script exporter

1. Create a standalone Apps Script project under an account with access to the source forms.
2. Paste `exporter/GoogleFormsToMoodle.gs` into a script file.
3. Enable the manifest in project settings and replace `appsscript.json` with the supplied manifest.
4. Associate a standard Google Cloud project, enable **Google Forms API** there,
   and configure the project's OAuth consent/access so the executing account can authorize it.
5. Set `CONFIG.SOURCE_FOLDER_ID` to your source folder ID or URL. It is intentionally blank in Git.
6. Run the selected export function and authorize the scopes from the manifest.

Automatic folder mode: `startFolderExport` snapshots forms directly in the configured folder.
Subfolders and shortcuts are not traversed. It processes bounded batches and schedules continuations.
Use `showFolderExportStatus` to inspect progress, `stopFolderExport` to stop future batches,
`resumeFolderExport` to continue, and `retryFailedFolderForms` after fixing failed forms.
`finishAndStartNewFolderExport` starts a fresh export without deleting old output folders.

Manual mode: populate `FORM_IDS` or set the folder, then run `exportBatch` repeatedly.
When export finishes, run `buildMoodlePackages` to create ZIP files from completed XML exports.

Keep output on Drive or in a separate private directory. Per-form source JSON and reports
contain source content and identifiers and are intentionally ignored by this repository.

## 3. Import and review

Choose the course, section, attempt limit, time limit and pagination; upload XML or ZIP.
Review the preview before confirming hidden quiz creation. Each quiz has its own question bank.
Preview questions, media, grading and review settings before enabling student visibility.

The plugin uses a course-module marker for deduplication. Do not edit that marker if you
want reimports to be skipped. Changed XML does not replace a previous quiz.
One file failure does not roll back earlier successful files in the batch.

## Validation

Run the bundled PHPUnit file within a configured Moodle test environment:
`vendor/bin/phpunit local/formsquiz/tests/importer_test.php`.
The repository does not include Moodle core, a database, production documents or credentials.
