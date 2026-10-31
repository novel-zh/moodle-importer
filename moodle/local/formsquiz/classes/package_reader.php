<?php
// SPDX-License-Identifier: GPL-3.0-or-later
namespace local_formsquiz;
defined('MOODLE_INTERNAL') || die();

/** Reads bounded XML entries without extracting ZIP paths onto the filesystem. */
class package_reader {
    public static function resolve(array $uploads): array {
        global $USER;
        $context = \context_user::instance($USER->id);
        $result = [];
        $bytes = 0;
        $seen = [];
        $draftid = file_get_unused_draft_itemid();
        foreach ($uploads as $upload) {
            $extension = strtolower(pathinfo($upload->get_filename(), PATHINFO_EXTENSION));
            if ($extension === 'xml') {
                self::append($result, $seen, $bytes, $upload);
                continue;
            }
            if ($extension !== 'zip' || !class_exists('ZipArchive')) {
                throw new \moodle_exception('badpackage', 'local_formsquiz');
            }
            $path = make_request_directory() . '/package.zip';
            $upload->copy_content_to($path);
            $zip = new \ZipArchive();
            if ($zip->open($path) !== true) {
                throw new \moodle_exception('badpackage', 'local_formsquiz');
            }
            try {
                if ($zip->numFiles > 500) {
                    throw new \moodle_exception('badpackage', 'local_formsquiz');
                }
                $found = false;
                for ($i = 0; $i < $zip->numFiles; $i++) {
                    $stat = $zip->statIndex($i);
                    $name = str_replace('\\', '/', $stat['name']);
                    if (preg_match('~(^/|(^|/)\.\.(/|$)|^[A-Za-z]:)~', $name)) {
                        throw new \moodle_exception('badpackage', 'local_formsquiz');
                    }
                    if (strtolower(pathinfo($name, PATHINFO_EXTENSION)) !== 'xml') {
                        continue;
                    }
                    $found = true;
                    if ($stat['size'] > 25 * 1024 * 1024 || $bytes + $stat['size'] > 100 * 1024 * 1024) {
                        throw new \moodle_exception('batchtoolarge', 'local_formsquiz');
                    }
                    $content = $zip->getFromIndex($i);
                    if ($content === false || strlen($content) !== $stat['size']) {
                        throw new \moodle_exception('badpackage', 'local_formsquiz');
                    }
                    $hash = sha1($content);
                    if (isset($seen[$hash])) { continue; }
                    if (count($result) >= 100) {
                        throw new \moodle_exception('nofiles', 'local_formsquiz');
                    }
                    $record = (object)['contextid' => $context->id, 'component' => 'user', 'filearea' => 'draft',
                        'itemid' => $draftid, 'filepath' => '/',
                        'filename' => substr($hash, 0, 8) . '_' . clean_param(basename($name), PARAM_FILE)];
                    $file = get_file_storage()->create_file_from_string($record, $content);
                    self::append($result, $seen, $bytes, $file);
                }
                if (!$found) { throw new \moodle_exception('badpackage', 'local_formsquiz'); }
            } finally { $zip->close(); }
        }
        if (!$result) { throw new \moodle_exception('nofiles', 'local_formsquiz'); }
        return $result;
    }

    private static function append(array &$result, array &$seen, int &$bytes, \stored_file $file): void {
        $hash = $file->get_contenthash();
        if (isset($seen[$hash])) { return; }
        $bytes += $file->get_filesize();
        if (count($result) >= 100 || $bytes > 100 * 1024 * 1024 || $file->get_filesize() > 25 * 1024 * 1024) {
            throw new \moodle_exception('batchtoolarge', 'local_formsquiz');
        }
        $seen[$hash] = true;
        $result[] = $file;
    }
}
