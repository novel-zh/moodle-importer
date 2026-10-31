<?php
// SPDX-License-Identifier: GPL-3.0-or-later
// Standalone smoke check; Moodle services are stubbed and the fixture is synthetic.
define('MOODLE_INTERNAL', true);
class moodle_exception extends Exception {
    public function __construct($code, $component = '', $link = '', $a = null) {
        parent::__construct($code);
    }
}
class core_text {
    public static function substr($text, $start, $length) {
        return mb_substr($text, $start, $length);
    }
}
function get_string($key, $component = '') { return $key; }
require __DIR__ . '/../moodle/local/formsquiz/classes/xml_inspector.php';
function verify($condition, $message) {
    if (!$condition) { throw new Exception($message); }
}
$xml = file_get_contents(__DIR__ . '/../moodle/local/formsquiz/tests/fixtures/quiz.xml');
$meta = local_formsquiz\xml_inspector::inspect($xml, 'fixture.xml');
verify($meta['scored'] === 1 && $meta['count'] === 2, 'Question counts');
verify($meta['images'] === 1 && $meta['sum'] === 2.0, 'Embedded image and marks');
$other = local_formsquiz\xml_inspector::inspect($xml, 'renamed.xml');
verify($meta['identity'] === $other['identity'], 'Dedup independent of filename');
foreach (['<!DOCTYPE quiz><quiz/>', '<broken>', preg_replace('/<file[^>]*>.*?<\/file>/s', '', $xml)] as $bad) {
    try {
        local_formsquiz\xml_inspector::inspect($bad, 'bad.xml');
        throw new Exception('Invalid XML accepted');
    } catch (moodle_exception $expected) {}
}
echo "PASS: synthetic XML, image, marks, dedup, malformed XML and missing media rejection.\n";
