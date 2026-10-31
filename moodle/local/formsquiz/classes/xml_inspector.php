<?php
// SPDX-License-Identifier: GPL-3.0-or-later
namespace local_formsquiz;
defined('MOODLE_INTERNAL') || die();

/** Inspect a Google Forms Moodle XML before creating any course content. */
class xml_inspector {
    public static function inspect(string $xml, string $filename): array {
        if (strlen($xml) > 25 * 1024 * 1024 || preg_match('/<!DOCTYPE|<!ENTITY/i', $xml)) {
            throw new \moodle_exception('invalidxml', 'local_formsquiz');
        }
        $previous = libxml_use_internal_errors(true);
        try {
            $doc = new \DOMDocument();
            $valid = $doc->loadXML($xml, LIBXML_NONET);
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
        if (!$valid || !$doc->documentElement || $doc->documentElement->tagName !== 'quiz') {
            throw new \moodle_exception('invalidxml', 'local_formsquiz');
        }
        $xpath = new \DOMXPath($doc);
        $nodes = $xpath->query('/quiz/question');
        if ($nodes->length > 1001) {
            throw new \moodle_exception('toomanyquestions', 'local_formsquiz');
        }
        $count = 0;
        $scored = 0;
        $sum = 0.0;
        $images = 0;
        $warnings = [];
        foreach ($nodes as $node) {
            $type = $node->getAttribute('type');
            if ($type === 'category') {
                continue;
            }
            if (!in_array($type, ['multichoice', 'shortanswer', 'essay', 'description'], true)) {
                throw new \moodle_exception('unsupportedtype', 'local_formsquiz', '', $type);
            }
            $count++;
            $grade = (float)$xpath->evaluate('string(defaultgrade)', $node);
            if (!is_finite($grade) || $grade < 0) {
                throw new \moodle_exception('invalidxml', 'local_formsquiz');
            }
            if ($type !== 'description') {
                $scored++;
                $sum += $grade;
            }
            if ($type === 'essay') {
                $warnings['essay'] = get_string('essaywarning', 'local_formsquiz');
            }
            if ($type === 'multichoice' && $xpath->evaluate('string(single)', $node) === 'false') {
                $warnings['checkbox'] = get_string('checkboxwarning', 'local_formsquiz');
            }
            // Verify every embedded file and its HTML reference before allowing an import.
            foreach ($xpath->query('.//file', $node) as $file) {
                $bytes = base64_decode(trim($file->textContent), true);
                if ($file->getAttribute('encoding') !== 'base64' || $bytes === false || $bytes === '') {
                    throw new \moodle_exception('invalidimage', 'local_formsquiz');
                }
                if (strlen($bytes) > 10 * 1024 * 1024 || $file->getAttribute('path') !== '/') {
                    throw new \moodle_exception('invalidimage', 'local_formsquiz');
                }
                $name = $file->getAttribute('name');
                if (!preg_match('/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|gif|webp)$/', $name) ||
                    @getimagesizefromstring($bytes) === false) {
                    throw new \moodle_exception('invalidimage', 'local_formsquiz');
                }
                $images++;
            }
            foreach ($xpath->query('.//questiontext|.//answer', $node) as $field) {
                $html = $xpath->evaluate('string(text)', $field);
                preg_match_all('/@@PLUGINFILE@@\/([a-zA-Z0-9_.-]+)/', $html, $refs);
                foreach ($refs[1] as $ref) {
                    $found = false;
                    foreach ($xpath->query('./file', $field) as $file) {
                        $found = $found || $file->getAttribute('name') === $ref;
                    }
                    if (!$found) {
                        throw new \moodle_exception('missingimage', 'local_formsquiz', '', $ref);
                    }
                }
            }
        }
        if ($scored === 0 || $sum <= 0 || !is_finite($sum)) {
            throw new \moodle_exception('noquestions', 'local_formsquiz');
        }
        $category = $xpath->evaluate('string(/quiz/question[@type="category"]/category/text)');
        $parts = explode('/', $category);
        $title = trim(end($parts));
        $formid = '';
        if (preg_match('/\[([A-Za-z0-9_-]+)\]$/', $title, $match)) {
            $formid = $match[1];
            $title = trim(preg_replace('/\s*\[[A-Za-z0-9_-]+\]$/', '', $title));
        }
        if (!$formid && preg_match('/^([A-Za-z0-9_-]{20,})(?:\(\d+\))?\.xml$/i', $filename, $match)) {
            $formid = $match[1];
        }
        if (!$title) {
            $title = pathinfo($filename, PATHINFO_FILENAME);
        }
        $title = \core_text::substr(strip_tags($title), 0, 250);
        return ['title' => $title, 'count' => $count, 'scored' => $scored,
            'sum' => $sum, 'images' => $images, 'warnings' => array_values($warnings),
            'identity' => 'gfquiz_' . hash('sha256', $formid ?: $xml)];
    }
}
