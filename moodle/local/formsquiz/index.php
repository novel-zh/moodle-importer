<?php
// SPDX-License-Identifier: GPL-3.0-or-later
require_once(__DIR__ . '/../../config.php');
require_once($CFG->libdir . '/adminlib.php');
require_once($CFG->libdir . '/filelib.php');
require_once($CFG->dirroot . '/course/lib.php');

require_login();
require_capability('moodle/site:config', context_system::instance());
if ((string)$CFG->branch !== '403') {
    throw new moodle_exception('wrongversion', 'local_formsquiz');
}
$courseid = optional_param('courseid', 0, PARAM_INT);
$confirm = optional_param('confirm', '', PARAM_ALPHANUM);
$PAGE->set_context(context_system::instance());
$PAGE->set_url('/local/formsquiz/index.php', ['courseid' => $courseid]);
$PAGE->set_pagelayout('admin');
$PAGE->set_title(get_string('pluginname', 'local_formsquiz'));
$PAGE->set_heading(get_string('pluginname', 'local_formsquiz'));

if (!$courseid) {
    echo $OUTPUT->header();
    echo $OUTPUT->heading(get_string('choosecourse', 'local_formsquiz'));
    $courses = $DB->get_records_select('course', 'id <> ?', [SITEID], 'fullname', 'id, fullname');
    $choices = [];
    foreach ($courses as $course) {
        $choices[$course->id] = format_string($course->fullname);
    }
    echo html_writer::start_tag('form', ['method' => 'get', 'action' => $PAGE->url]);
    echo html_writer::select($choices, 'courseid', '', ['' => get_string('choose')]);
    echo html_writer::empty_tag('input', ['type' => 'submit', 'value' => get_string('continue'),
        'class' => 'btn btn-primary ml-2']);
    echo html_writer::end_tag('form');
    echo $OUTPUT->footer();
    exit;
}

$course = $DB->get_record('course', ['id' => $courseid], '*', MUST_EXIST);
if ($courseid === SITEID) {
    throw new moodle_exception('invalidcourseid');
}
require_login($course);
$coursecontext = context_course::instance($courseid);
require_capability('moodle/course:manageactivities', $coursecontext);
require_capability('mod/quiz:addinstance', $coursecontext);
$PAGE->set_context($coursecontext);
$sections = [];
foreach (get_fast_modinfo($course)->get_section_info_all() as $section) {
    $sections[$section->section] = get_section_name($course, $section);
}
$form = new \local_formsquiz\import_form($PAGE->url,
    ['courseid' => $courseid, 'sections' => $sections]);
if ($form->is_cancelled()) {
    redirect(new moodle_url('/course/view.php', ['id' => $courseid]));
}

function local_formsquiz_draftfiles(int $draftid): array {
    global $USER;
    $context = context_user::instance($USER->id);
    return array_values(get_file_storage()->get_area_files($context->id, 'user', 'draft', $draftid,
        'filename ASC', false));
}

if ($confirm !== '') {
    require_sesskey();
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        throw new moodle_exception('invalidrequest', 'error');
    }
    $pending = $SESSION->local_formsquiz_pending[$confirm] ?? null;
    if (!$pending || $pending->courseid !== $courseid || time() - $pending->created > 1800) {
        throw new moodle_exception('expired', 'local_formsquiz');
    }
    $files = local_formsquiz_draftfiles($pending->draftid);
    $hashes = array_map(static function($file) { return $file->get_contenthash(); }, $files);
    if ($hashes !== $pending->hashes || !$files) {
        throw new moodle_exception('expired', 'local_formsquiz');
    }
    $expanded = [];
    foreach ($pending->fileids as $index => $fileid) {
        $file = get_file_storage()->get_file_by_id($fileid);
        if (!$file || (int)$file->get_contextid() !== context_user::instance($USER->id)->id ||
                $file->get_component() !== 'user' || $file->get_filearea() !== 'draft' ||
                $file->get_contenthash() !== $pending->expandedhashes[$index]) {
            throw new moodle_exception('expired', 'local_formsquiz');
        }
        $expanded[] = $file;
    }
    $files = $expanded;
    unset($SESSION->local_formsquiz_pending[$confirm]);
    echo $OUTPUT->header();
    echo $OUTPUT->heading(get_string('results', 'local_formsquiz'));
    core_php_time_limit::raise(600);
    raise_memory_limit(MEMORY_EXTRA);
    foreach ($files as $file) {
        try {
            $result = \local_formsquiz\importer::create($course, $pending->options, $file);
            $message = get_string($result['existing'] ? 'alreadyimported' : 'created', 'local_formsquiz',
                (object)['name' => $result['meta']['title'], 'count' => $result['meta']['scored']]);
            echo $OUTPUT->notification($message, $result['existing'] ? 'info' : 'success');
            echo html_writer::tag('p', html_writer::link(new moodle_url('/mod/quiz/view.php',
                ['id' => $result['cmid']]), get_string('openquiz', 'local_formsquiz')));
        } catch (Throwable $error) {
            echo $OUTPUT->notification(s($file->get_filename()) . ': ' . s($error->getMessage()), 'error');
        }
    }
    echo $OUTPUT->notification(get_string('afterimport', 'local_formsquiz'), 'info');
    echo $OUTPUT->single_button(new moodle_url('/course/view.php', ['id' => $courseid]),
        get_string('backtocourse', 'local_formsquiz'), 'get');
    echo $OUTPUT->footer();
    exit;
}

if ($data = $form->get_data()) {
    $files = local_formsquiz_draftfiles((int)$data->xmlfiles);
    $uploads = $files;
    $metas = [];
    $problems = [];
    $totalbytes = 0;
    if (!$files || count($files) > 100) {
        $problems[] = get_string('nofiles', 'local_formsquiz');
    }
    foreach ($files as $file) {
        $totalbytes += $file->get_filesize();
    }
    if ($totalbytes > 100 * 1024 * 1024) {
        $problems[] = get_string('batchtoolarge', 'local_formsquiz');
    }
    if (!$problems) {
        try {
            $files = \local_formsquiz\package_reader::resolve($uploads);
        } catch (Throwable $error) {
            $problems[] = $error->getMessage();
        }
    }
    if (!$problems) {
        foreach ($files as $file) {
            try {
                $metas[] = \local_formsquiz\xml_inspector::inspect($file->get_content(), $file->get_filename());
            } catch (Throwable $error) {
                $problems[] = $file->get_filename() . ': ' . $error->getMessage();
            }
        }
    }
    echo $OUTPUT->header();
    if ($problems) {
        foreach ($problems as $problem) {
            echo $OUTPUT->notification(s($problem), 'error');
        }
        $form->display();
    } else {
        $token = bin2hex(random_bytes(16));
        // One pending preview per browser session; draft files remain owned by the uploading admin.
        $SESSION->local_formsquiz_pending = [$token => (object)[
            'courseid' => $courseid, 'draftid' => (int)$data->xmlfiles, 'created' => time(),
            'hashes' => array_map(static function($file) { return $file->get_contenthash(); }, $uploads),
            'fileids' => array_map(static function($file) { return $file->get_id(); }, $files),
            'expandedhashes' => array_map(static function($file) { return $file->get_contenthash(); }, $files),
            'options' => (object)['sectionnum' => (int)$data->sectionnum, 'attempts' => (int)$data->attempts,
                'minutes' => (int)$data->minutes, 'perpage' => (int)$data->perpage],
        ]];
        echo $OUTPUT->heading(get_string('preview', 'local_formsquiz'));
        echo html_writer::tag('p', s(format_string($course->fullname) . ' → ' . $sections[$data->sectionnum]));
        $table = new html_table();
        $table->head = [get_string('quizname', 'local_formsquiz'), get_string('questioncount', 'local_formsquiz'),
            get_string('imagecount', 'local_formsquiz'), get_string('totalgrade', 'local_formsquiz')];
        foreach ($metas as $meta) {
            $table->data[] = [s($meta['title']), $meta['scored'], $meta['images'], $meta['sum']];
            foreach ($meta['warnings'] as $warning) {
                echo $OUTPUT->notification(s($meta['title'] . ': ' . $warning), 'warning');
            }
        }
        echo html_writer::table($table);
        echo $OUTPUT->notification(get_string('notice', 'local_formsquiz'), 'info');
        echo $OUTPUT->single_button(new moodle_url('/local/formsquiz/index.php',
            ['courseid' => $courseid, 'confirm' => $token]), get_string('confirmcreate', 'local_formsquiz'), 'post');
        echo html_writer::link($PAGE->url, get_string('cancel'));
    }
    echo $OUTPUT->footer();
    exit;
}
echo $OUTPUT->header();
echo $OUTPUT->heading(format_string($course->fullname));
$form->display();
echo $OUTPUT->footer();
