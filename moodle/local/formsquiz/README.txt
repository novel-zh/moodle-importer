Google Forms ready quiz import / local_formsquiz
Release: 0.3.0 (100 quiz ZIP import). Target: Moodle 4.3.x.
License: GNU GPL v3 or later. See LICENSE.txt.

Install this folder as local/formsquiz, or ZIP the formsquiz folder and upload
that archive through Moodle's plugin installer. Open /local/formsquiz/index.php.
Site configuration capability is required.

Upload Moodle XML files or ZIP archives, select a course and section, review
the import plan, and create hidden quizzes. Up to 100 resolved XML files,
25 MiB per XML and 100 MiB total. Server upload limits may be lower.

Supported question types: multichoice, shortanswer, essay and description.
Images are embedded. Reimport deduplication never replaces existing quizzes.
Each quiz uses an activity-context question bank and its own DB transaction.
Validation and preview happen before confirmation. See the repository README
for the Google Apps Script exporter and the complete setup workflow.

Tests: tests/importer_test.php, using the synthetic tests/fixtures/quiz.xml.
No personal documents or credentials are included.
