<?php
// SPDX-License-Identifier: GPL-3.0-or-later
defined('MOODLE_INTERNAL') || die();
$plugin->component = 'local_formsquiz';
$plugin->version = 2026101400;
$plugin->requires = 2023100900;
$plugin->supported = [403, 403];
$plugin->maturity = MATURITY_BETA;
$plugin->release = '0.3.0 (100 quiz ZIP import)';
$plugin->dependencies = ['mod_quiz' => 2023100900];
