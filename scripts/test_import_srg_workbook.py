import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

sys.path.insert(0, str(Path(__file__).parent))
from import_srg_workbook import import_workbook


def inline_cell(reference, value, style=0):
    return f'<c r="{reference}" s="{style}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'


def number_cell(reference, value):
    return f'<c r="{reference}"><v>{value}</v></c>'


def sample_workbook(path, omit_last_slot=False):
    rows = [
        '<row r="1">' + inline_cell('A1', 'Game') + '</row>',
        '<row r="2">' + inline_cell('B2', 'Card #') + inline_cell('C2', 'Personal') + inline_cell('D2', 'Dupes') + '</row>',
    ]
    row_number = 3
    for game, style in [('Game One', 1), ('Game Two', 2)]:
        slots = ['Title', '1', '2', '3', '4', '5']
        if omit_last_slot and game == 'Game Two':
            slots.pop()
        for index, slot in enumerate(slots):
            cells = []
            if index == 0:
                cells.append(inline_cell(f'A{row_number}', game, style))
            cells.append(inline_cell(f'B{row_number}', slot))
            cells.append(number_cell(f'C{row_number}', 1))
            cells.append(number_cell(f'D{row_number}', 2 if game == 'Game One' and slot == 'Title' else 0))
            if game == 'Game One' and slot == 'Title':
                cells.append(inline_cell(f'E{row_number}', 'Workbook note'))
            rows.append(f'<row r="{row_number}">{"".join(cells)}</row>')
            row_number += 1
    sheet = ('<?xml version="1.0" encoding="UTF-8"?>'
             '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
             f'<sheetData>{"".join(rows)}</sheetData></worksheet>')
    workbook = ('<?xml version="1.0" encoding="UTF-8"?>'
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
                '<sheets><sheet name="Switch Games" sheetId="1" r:id="rId1"/></sheets></workbook>')
    relationships = ('<?xml version="1.0" encoding="UTF-8"?>'
                     '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                     '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                     'Target="worksheets/sheet1.xml"/></Relationships>')
    styles = ('<?xml version="1.0" encoding="UTF-8"?>'
              '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
              '<fills count="3"><fill><patternFill patternType="none"/></fill>'
              '<fill><patternFill patternType="solid"><fgColor rgb="FF00FF00"/></patternFill></fill>'
              '<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/></patternFill></fill></fills>'
              '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
              '<xf numFmtId="0" fontId="0" fillId="1" borderId="0" xfId="0"/>'
              '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0"/></cellXfs></styleSheet>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('xl/workbook.xml', workbook)
        archive.writestr('xl/_rels/workbook.xml.rels', relationships)
        archive.writestr('xl/styles.xml', styles)
        archive.writestr('xl/worksheets/sheet1.xml', sheet)


class SuperRareWorkbookImportTest(unittest.TestCase):
    def test_multiple_games_import_into_one_set_and_keep_card_identity_and_inventory(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'sample.xlsx'
            sample_workbook(source)
            original_bytes = source.read_bytes()
            backup, report = import_workbook(source)

            srg_sets = [item for item in backup['catalog']['sets'] if item['seriesId'] == 'series:srg-switch']
            cards = backup['catalog']['cards']
            self.assertEqual(len(srg_sets), 1)
            self.assertEqual(srg_sets[0]['id'], 'set:srg-switch:nintendo-switch-releases')
            self.assertEqual(len(cards), 12)
            self.assertTrue(all(card['setId'] == srg_sets[0]['id'] for card in cards))
            self.assertEqual(len({card['id'] for card in cards}), 12)
            title = next(card for card in cards if card['id'] == 'set:srg-switch:game-one:title')
            self.assertEqual(title['releaseName'], 'Game One')
            self.assertEqual(title['releaseSourceCompletionIndicator'], 'complete')
            self.assertEqual(title['releaseSourceRow'], 3)
            self.assertEqual(title['sourceNote'], 'Workbook note')
            title_inventory = next(item for item in backup['catalog']['ownership'] if item['cardId'] == title['id'])
            self.assertEqual((title_inventory['personal'], title_inventory['duplicates'], title_inventory['incoming']), (1, 2, 0))
            self.assertEqual(backup['schemaVersion'], 5)
            self.assertEqual(len(report['markerMismatches']), 1)
            self.assertEqual(report['markerMismatches'][0]['title'], 'Game Two')
            self.assertEqual(source.read_bytes(), original_bytes)

    def test_invalid_slot_counts_stop_the_import(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'incomplete.xlsx'
            sample_workbook(source, omit_last_slot=True)
            with self.assertRaisesRegex(ValueError, 'must have exactly Title and cards 1–5'):
                import_workbook(source)


if __name__ == '__main__':
    unittest.main()
