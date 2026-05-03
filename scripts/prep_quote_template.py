"""Prepare DOCX template with placeholders for docxtemplater.

Takes   apps/web/public/quote-templates/original.docx
Writes  apps/web/public/quote-templates/template.docx

Placeholders inserted:
  {quote_date}   — replaces the existing date value (e.g. "01st May 2026")
  {to_address}   — replaces the multi-line address block below "To, "
  {subject}      — replaces "Masonry Works" on the Sub: line
  Table row:
    {#items} at start of the first data row, {/items} at the end
    Cell values: {sno}, {scope}, {qty}, {rate}, {amount}
  {grand_total}  — replaces ₹30,000 in the GRAND TOTAL row
  The second data row (GROUTING WORK) is deleted.

All other template content — logo, header/footer, account details, payment
terms, T&Cs — is preserved exactly.
"""
from __future__ import annotations
import io
import os
import shutil
import sys
import zipfile

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC  = os.path.join(ROOT, 'apps', 'web', 'public', 'quote-templates', 'original.docx')
DST  = os.path.join(ROOT, 'apps', 'web', 'public', 'quote-templates', 'template.docx')
WORK = os.path.join(ROOT, '.quote_work_tmp')


def fatal(msg: str) -> None:
    print(f'ERROR: {msg}')
    sys.exit(1)


def main() -> None:
    if not os.path.isfile(SRC):
        fatal(f'Source template not found: {SRC}')

    if os.path.isdir(WORK):
        shutil.rmtree(WORK)
    os.makedirs(WORK)

    with zipfile.ZipFile(SRC) as z:
        z.extractall(WORK)

    doc_path = os.path.join(WORK, 'word', 'document.xml')
    with open(doc_path, 'r', encoding='utf-8') as f:
        xml = f.read()

    # ===================================================================
    # 1. Date paragraph  —  keep "Date: " run, replace the rest with {quote_date}
    # ===================================================================
    date_idx = xml.find('Date: ')
    if date_idx < 0:
        fatal('Could not find "Date: " text')
    p_start = xml.rfind('<w:p ', 0, date_idx)
    p_end   = xml.find('</w:p>', date_idx) + len('</w:p>')
    date_para = xml[p_start:p_end]

    marker = '<w:t xml:space="preserve">Date: </w:t></w:r>'
    mi = date_para.find(marker)
    if mi < 0:
        fatal('Could not find "Date: " run terminator')

    date_rpr = (
        '<w:rPr>'
        '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorHAnsi"/>'
        '<w:b/><w:color w:val="auto"/><w:sz w:val="20"/><w:szCs w:val="24"/>'
        '</w:rPr>'
    )
    new_date_run = (
        f'<w:r w:rsidRPr="00E65232">{date_rpr}'
        f'<w:t>{{quote_date}}</w:t>'
        '</w:r>'
    )
    new_date_para = date_para[:mi + len(marker)] + new_date_run + '</w:p>'
    xml = xml[:p_start] + new_date_para + xml[p_end:]

    # ===================================================================
    # 2. To address  —  replace the two content paragraphs with one
    # ===================================================================
    start_idx = xml.find('THE SOCIETY MANAGEMENT')
    if start_idx < 0:
        fatal('Could not find "THE SOCIETY MANAGEMENT" (first address line)')
    to_p1_start = xml.rfind('<w:p ', 0, start_idx)
    end_idx = xml.find('BACHUPALLY')
    if end_idx < 0:
        fatal('Could not find "BACHUPALLY" (last address line)')
    to_p2_end = xml.find('</w:p>', end_idx) + len('</w:p>')

    addr_rpr = (
        '<w:rPr>'
        '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorHAnsi"/>'
        '<w:b/><w:sz w:val="20"/><w:lang w:val="en-US"/>'
        '</w:rPr>'
    )
    new_addr_para = (
        '<w:p w:rsidR="00E65232" w:rsidRPr="00E65232" w:rsidRDefault="00380FD7" w:rsidP="00380FD7">'
        f'<w:pPr>{addr_rpr}</w:pPr>'
        f'<w:r w:rsidRPr="00E65232">{addr_rpr}<w:t>{{to_address}}</w:t></w:r>'
        '</w:p>'
    )
    xml = xml[:to_p1_start] + new_addr_para + xml[to_p2_end:]

    # ===================================================================
    # 3. Subject  —  "Masonry " + "Works." → "{subject}."
    # ===================================================================
    subj_sentinel = '<w:t xml:space="preserve">Masonry </w:t></w:r>'
    si = xml.find(subj_sentinel)
    if si < 0:
        fatal('Could not find "Masonry " run')
    m_run_end = si + len(subj_sentinel)
    m_run_start = xml.rfind('<w:r ', 0, si)
    works_run_start = xml.find('<w:r ', m_run_end)
    works_run_end = xml.find('</w:r>', works_run_start) + len('</w:r>')

    subj_rpr = (
        '<w:rPr>'
        '<w:rFonts w:asciiTheme="minorHAnsi" w:hAnsiTheme="minorHAnsi" w:cstheme="minorHAnsi"/>'
        '<w:b/><w:sz w:val="20"/><w:lang w:val="en-US"/>'
        '</w:rPr>'
    )
    new_subj_run = (
        f'<w:r w:rsidRPr="00E65232">{subj_rpr}'
        f'<w:t>{{subject}}.</w:t>'
        '</w:r>'
    )
    xml = xml[:m_run_start] + new_subj_run + xml[works_run_end:]

    # ===================================================================
    # 4. Table: replace first data row cells with placeholders,
    #    add {#items} at cell 1, {/items} at cell 5
    # ===================================================================
    row_idx = xml.find('PIPELINE BORE PACKING')
    if row_idx < 0:
        fatal('Could not find first data row "PIPELINE BORE PACKING"')
    tr_start = xml.rfind('<w:tr ', 0, row_idx)
    tr_end   = xml.find('</w:tr>', row_idx) + len('</w:tr>')
    row_xml = xml[tr_start:tr_end]

    def replace_once(s: str, old: str, new: str) -> str:
        if old not in s:
            fatal(f'Expected {old!r} not found in first data row')
        return s.replace(old, new, 1)

    row_xml = replace_once(row_xml, '<w:t>1</w:t>',
                           '<w:t>{#items}{sno}</w:t>')
    row_xml = replace_once(row_xml, '<w:t xml:space="preserve">PIPELINE BORE PACKING </w:t>',
                           '<w:t>{scope}</w:t>')
    row_xml = replace_once(row_xml, '<w:t>21 HOLES</w:t>',
                           '<w:t>{qty}</w:t>')
    row_xml = replace_once(row_xml, '<w:t>₹15,000</w:t>',
                           '<w:t>{rate}</w:t>')
    row_xml = replace_once(row_xml, '<w:t>₹15,000</w:t>',
                           '<w:t>{amount}{/items}</w:t>')

    xml = xml[:tr_start] + row_xml + xml[tr_end:]

    # ===================================================================
    # 5. Delete second data row (GROUTING WORK)
    # ===================================================================
    g_idx = xml.find('GROUTING')
    if g_idx >= 0:
        g_tr_start = xml.rfind('<w:tr ', 0, g_idx)
        g_tr_end   = xml.find('</w:tr>', g_idx) + len('</w:tr>')
        xml = xml[:g_tr_start] + xml[g_tr_end:]
    else:
        print('WARN: no second data row (GROUTING) to delete — continuing')

    # ===================================================================
    # 6. Grand total: ₹30,000 → {grand_total}
    # ===================================================================
    gt = '<w:t>₹30,000</w:t>'
    if gt not in xml:
        fatal('Could not find GRAND TOTAL value run "₹30,000"')
    xml = xml.replace(gt, '<w:t>{grand_total}</w:t>', 1)

    # ===================================================================
    # Write document.xml back and repack the DOCX
    # ===================================================================
    with open(doc_path, 'w', encoding='utf-8') as f:
        f.write(xml)

    if os.path.exists(DST):
        os.remove(DST)

    with zipfile.ZipFile(DST, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _dirs, files in os.walk(WORK):
            for name in files:
                full = os.path.join(root, name)
                arc = os.path.relpath(full, WORK).replace(os.sep, '/')
                z.write(full, arc)

    # Clean up working dir
    shutil.rmtree(WORK)

    size = os.path.getsize(DST)
    print(f'Template written: {DST} ({size} bytes)')


if __name__ == '__main__':
    main()
