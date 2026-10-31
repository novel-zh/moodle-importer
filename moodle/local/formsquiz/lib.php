<?php
// SPDX-License-Identifier: GPL-3.0-or-later
defined('MOODLE_INTERNAL') || die();

function local_formsquiz_extend_navigation_course($navigation, $course, $context) {
    if (has_capability('moodle/site:config', context_system::instance())) {
        $navigation->add(get_string('pluginname', 'local_formsquiz'),
            new moodle_url('/local/formsquiz/index.php', ['courseid' => $course->id]),
            navigation_node::TYPE_CUSTOM, null, 'local_formsquiz');
    }
}
