<?php
// SPDX-License-Identifier: GPL-3.0-or-later
namespace local_formsquiz;
defined('MOODLE_INTERNAL') || die();

/** Creates quizzes using Moodle's module and XML question APIs. */
class importer {
    public static function create(\stdClass $course, \stdClass $options, \stored_file $file): array {
        $factory = \core\lock\lock_config::get_lock_factory('local_formsquiz');
        $lock = $factory->get_lock('course_' . $course->id, 10);
        if (!$lock) {
            throw new \moodle_exception('busy', 'local_formsquiz');
        }
        try {
            return self::execute($course, $options, $file);
        } finally {
            $lock->release();
        }
    }

    private static function execute(\stdClass $course, \stdClass $options, \stored_file $file): array {
        global $CFG, $DB;
        require_once($CFG->dirroot . '/course/modlib.php');
        require_once($CFG->dirroot . '/mod/quiz/locallib.php');
        require_once($CFG->libdir . '/questionlib.php');
        require_once($CFG->dirroot . '/question/format/xml/format.php');

        require_capability('moodle/site:config', \context_system::instance());
        $context = \context_course::instance($course->id);
        require_capability('moodle/course:manageactivities', $context);
        require_capability('mod/quiz:addinstance', $context);
        $meta = xml_inspector::inspect($file->get_content(), $file->get_filename());
        $quizmodule = $DB->get_record('modules', ['name' => 'quiz'], '*', MUST_EXIST);
        $existing = $DB->get_record('course_modules', ['course' => $course->id,
            'module' => $quizmodule->id, 'idnumber' => $meta['identity'], 'deletioninprogress' => 0]);
        if ($existing) {
            return ['existing' => true, 'cmid' => (int)$existing->id, 'meta' => $meta];
        }
        if (!$DB->record_exists('course_sections', ['course' => $course->id, 'section' => $options->sectionnum])) {
            throw new \moodle_exception('invalidsection', 'local_formsquiz');
        }
        if (!course_allowed_module($course, 'quiz')) {
            throw new \moodle_exception('moduledisable');
        }
        $path = make_request_directory() . '/questions.xml';
        $file->copy_content_to($path);
        $transaction = $DB->start_delegated_transaction();
        $bufferlevel = ob_get_level();
        try {
            $module = (object)[
                'modulename' => 'quiz', 'module' => $quizmodule->id, 'section' => $options->sectionnum,
                'name' => $meta['title'], 'intro' => '', 'introformat' => FORMAT_HTML,
                'visible' => 0, 'visibleoncoursepage' => 1, 'cmidnumber' => $meta['identity'],
                'groupmode' => 0, 'groupingid' => 0, 'completion' => 0,
                'timeopen' => 0, 'timeclose' => 0, 'timelimit' => $options->minutes * 60,
                'preferredbehaviour' => 'deferredfeedback', 'attempts' => $options->attempts,
                'attemptonlast' => 0, 'grademethod' => QUIZ_GRADEHIGHEST,
                'decimalpoints' => 2, 'questiondecimalpoints' => -1,
                'questionsperpage' => $options->perpage, 'shuffleanswers' => 1,
                'sumgrades' => 0, 'grade' => $meta['sum'], 'overduehandling' => 'autosubmit',
                'graceperiod' => 0, 'quizpassword' => '', 'subnet' => '', 'browsersecurity' => '',
                'delay1' => 0, 'delay2' => 0, 'showuserpicture' => 0, 'showblocks' => 0,
                'navmethod' => QUIZ_NAVMETHOD_FREE, 'completionunlocked' => 1,
                'completionminattempts' => 0, 'completionattemptsexhausted' => 0,
                'attemptduring' => 1, 'maxmarksduring' => 1,
            ];
            foreach (['immediately', 'open', 'closed'] as $when) {
                // Show submitted answers and grade; don't disclose answer keys until the admin configures review.
                foreach (['attempt', 'maxmarks', 'marks'] as $field) {
                    $module->{$field . $when} = 1;
                }
            }
            $created = add_moduleinfo($module, $course);
            $modcontext = \context_module::instance($created->coursemodule);
            require_capability('moodle/question:add', $modcontext);
            require_capability('moodle/question:managecategory', $modcontext);
            $top = question_get_top_category($modcontext->id, true);
            $category = (object)['contextid' => $modcontext->id, 'parent' => $top->id,
                'name' => $meta['title'], 'info' => '', 'infoformat' => FORMAT_HTML,
                'stamp' => make_unique_id_code(), 'sortorder' => 999];
            $category->id = $DB->insert_record('question_categories', $category);
            \core\event\question_category_created::create_from_question_category_instance($category, $modcontext)->trigger();

            $format = new \qformat_xml();
            $format->setCategory($category);
            $format->setContexts([$modcontext, $context]);
            $format->setCourse($course);
            $format->setFilename($path);
            $format->setRealfilename($file->get_filename());
            $format->setMatchgrades('error');
            $format->setCatfromfile(false);
            $format->setContextfromfile(false);
            $format->setStoponerror(true);
            $format->set_display_progress(false);
            ob_start();
            $ok = $format->importpreprocess() && $format->importprocess() && $format->importpostprocess();
            $diagnostics = ob_get_clean();
            if (!$ok || $format->importerrors || count($format->questionids) !== $meta['count']) {
                throw new \moodle_exception('importfailed', 'local_formsquiz', '',
                    trim(strip_tags($diagnostics)));
            }
            $quiz = $DB->get_record('quiz', ['id' => $created->instance], '*', MUST_EXIST);
            $quiz->cmid = $created->coursemodule;
            // questionids are in XML order, unlike name-sorted question bank lists.
            foreach ($format->questionids as $questionid) {
                if (quiz_add_quiz_question($questionid, $quiz) === false) {
                    throw new \moodle_exception('importfailed', 'local_formsquiz', '', 'Duplicate question slot');
                }
            }
            $quizobj = \mod_quiz\quiz_settings::create($quiz->id);
            $quizobj->get_grade_calculator()->recompute_quiz_sumgrades();
            $quiz = $DB->get_record('quiz', ['id' => $quiz->id], '*', MUST_EXIST);
            if (abs($quiz->sumgrades - $meta['sum']) > 0.00001) {
                throw new \moodle_exception('importfailed', 'local_formsquiz', '', 'Grade sum mismatch');
            }
            quiz_grade_item_update($quiz);
            $transaction->allow_commit();
            rebuild_course_cache($course->id, true);
            return ['existing' => false, 'cmid' => (int)$created->coursemodule, 'meta' => $meta];
        } catch (\Throwable $error) {
            while (ob_get_level() > $bufferlevel) {
                ob_end_clean();
            }
            try {
                $transaction->rollback($error);
            } finally {
                rebuild_course_cache($course->id, true);
            }
            throw $error;
        }
    }
}
