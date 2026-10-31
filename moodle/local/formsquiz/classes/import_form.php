<?php
// SPDX-License-Identifier: GPL-3.0-or-later
namespace local_formsquiz;
defined('MOODLE_INTERNAL') || die();
global $CFG;
require_once($CFG->libdir . '/formslib.php');

class import_form extends \moodleform {
    public function definition() {
        $mform = $this->_form;
        $mform->addElement('hidden', 'courseid', $this->_customdata['courseid']);
        $mform->setType('courseid', PARAM_INT);
        $mform->addElement('select', 'sectionnum', get_string('section', 'local_formsquiz'),
            $this->_customdata['sections']);
        $mform->setType('sectionnum', PARAM_INT);
        $mform->addElement('filemanager', 'xmlfiles', get_string('xmlfiles', 'local_formsquiz'), null,
            ['subdirs' => 0, 'maxfiles' => 100, 'maxbytes' => 100 * 1024 * 1024, 'accepted_types' => ['.xml', '.zip']]);
        $mform->addRule('xmlfiles', null, 'required');
        $mform->addElement('text', 'attempts', get_string('attempts', 'local_formsquiz'));
        $mform->setType('attempts', PARAM_INT);
        $mform->setDefault('attempts', 1);
        $mform->addElement('text', 'minutes', get_string('minutes', 'local_formsquiz'));
        $mform->setType('minutes', PARAM_INT);
        $mform->setDefault('minutes', 0);
        $mform->addElement('select', 'perpage', get_string('perpage', 'local_formsquiz'),
            [0 => get_string('allonepage', 'local_formsquiz'), 1 => '1', 5 => '5', 10 => '10']);
        $mform->setType('perpage', PARAM_INT);
        $mform->setDefault('perpage', 0);
        $mform->addElement('static', 'notice', '', get_string('notice', 'local_formsquiz'));
        $this->add_action_buttons(true, get_string('createquizzes', 'local_formsquiz'));
    }

    public function validation($data, $files) {
        $errors = parent::validation($data, $files);
        if (!array_key_exists($data['sectionnum'], $this->_customdata['sections'])) {
            $errors['sectionnum'] = get_string('invalidsection', 'local_formsquiz');
        }
        foreach (['attempts' => 100, 'minutes' => 10080] as $field => $limit) {
            if ($data[$field] < 0 || $data[$field] > $limit) {
                $errors[$field] = get_string('invalidnumber', 'local_formsquiz', $limit);
            }
        }
        return $errors;
    }
}
