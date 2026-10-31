<?php
// SPDX-License-Identifier: GPL-3.0-or-later
namespace local_formsquiz;
defined('MOODLE_INTERNAL') || die();

/** @covers \local_formsquiz\importer */
class importer_test extends \advanced_testcase {
    public function test_creates_hidden_quiz_with_order_images_and_no_duplicate(): void {
        global $DB;
        $this->resetAfterTest();
        $this->setAdminUser();
        $course = $this->getDataGenerator()->create_course();
        course_create_sections_if_missing($course, 1);
        $file = get_file_storage()->create_file_from_pathname((object)[
            'contextid' => \context_system::instance()->id, 'component' => 'local_formsquiz',
            'filearea' => 'test', 'itemid' => 0, 'filepath' => '/', 'filename' => 'pilot.xml',
        ], __DIR__ . '/fixtures/quiz.xml');
        $options = (object)['sectionnum' => 1, 'minutes' => 20, 'attempts' => 1, 'perpage' => 0];
        $result = importer::create($course, $options, $file);
        $this->assertFalse($result['existing']);
        $cm = get_coursemodule_from_id('quiz', $result['cmid']);
        $this->assertEquals(0, $cm->visible);
        $quiz = $DB->get_record('quiz', ['id' => $cm->instance]);
        $this->assertEquals(2, $quiz->sumgrades);
        $this->assertEquals(2, $quiz->grade);
        $this->assertEquals(1200, $quiz->timelimit);
        $slots = array_values($DB->get_records('quiz_slots', ['quizid' => $quiz->id], 'slot ASC'));
        $this->assertCount(2, $slots);
        $this->assertEquals(0, $slots[0]->maxmark);
        $this->assertEquals(2, $slots[1]->maxmark);
        $context = \context_module::instance($cm->id);
        $picture = $DB->get_record('question', ['name' => 'Question with picture']);
        $this->assertCount(1, get_file_storage()->get_area_files($context->id,
            'question', 'questiontext', $picture->id, '', false));
        $second = importer::create($course, $options, $file);
        $this->assertTrue($second['existing']);
        $this->assertEquals($cm->id, $second['cmid']);
        $this->assertEquals(1, $DB->count_records('quiz', ['course' => $course->id]));
    }

    public function test_malformed_image_creates_no_quiz(): void {
        global $DB;
        $this->resetAfterTest();
        $this->setAdminUser();
        $course = $this->getDataGenerator()->create_course();
        course_create_sections_if_missing($course, 1);
        $xml = str_replace('encoding="base64"', 'encoding="invalid"',
            file_get_contents(__DIR__ . '/fixtures/quiz.xml'));
        $file = get_file_storage()->create_file_from_string((object)[
            'contextid' => \context_system::instance()->id, 'component' => 'local_formsquiz',
            'filearea' => 'test', 'itemid' => 0, 'filepath' => '/', 'filename' => 'bad.xml',
        ], $xml);
        try {
            importer::create($course, (object)['sectionnum' => 1, 'minutes' => 0, 'attempts' => 1, 'perpage' => 0], $file);
            $this->fail('Expected invalid image exception');
        } catch (\moodle_exception $exception) {
            $this->assertEquals('invalidimage', $exception->errorcode);
        }
        $this->assertEquals(0, $DB->count_records('quiz', ['course' => $course->id]));
    }
}
