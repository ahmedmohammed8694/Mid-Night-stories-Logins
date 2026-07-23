import zipfile
import xml.etree.ElementTree as ET
import os

try:
    excel_path = os.path.join('SEO Files', 'issues_overview_report.xlsx')
    if not os.path.exists(excel_path):
        print(f"Error: {excel_path} not found!")
        exit(1)

    with zipfile.ZipFile(excel_path) as z:
        # 1. Read shared strings
        shared_strings = []
        if 'xl/sharedStrings.xml' in z.namelist():
            ss_data = z.read('xl/sharedStrings.xml')
            ss_root = ET.fromstring(ss_data)
            ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
            for si in ss_root.findall('ns:si', ns):
                parts = []
                for t in si.findall('.//ns:t', ns):
                    if t.text:
                        parts.append(t.text)
                shared_strings.append(''.join(parts))

        # 2. Read sheet1
        sheet_files = [name for name in z.namelist() if name.startswith('xl/worksheets/')]
        if not sheet_files:
            print("No sheet files found!")
            exit(1)
            
        sheet_data = z.read(sheet_files[0])
        sheet_root = ET.fromstring(sheet_data)
        
        ns = {'ns': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
        rows = []
        
        for row in sheet_root.findall('.//ns:row', ns):
            row_num = int(row.get('r'))
            cells = {}
            for c in row.findall('ns:c', ns):
                r = c.get('r')
                col_letter = ''.join([char for char in r if char.isalpha()])
                t = c.get('t')
                
                val_text = ''
                if t == 'inlineStr':
                    is_el = c.find('ns:is', ns)
                    if is_el is not None:
                        t_el = is_el.find('ns:t', ns)
                        if t_el is not None:
                            val_text = t_el.text or ''
                else:
                    v = c.find('ns:v', ns)
                    if v is not None:
                        val_text = v.text or ''
                        
                    if t == 's' and val_text:
                        str_idx = int(val_text)
                        if str_idx < len(shared_strings):
                            val_text = shared_strings[str_idx]
                            
                cells[col_letter] = val_text
            rows.append((row_num, cells))

    # Build a clean Markdown table of the contents
    md = "# Screaming Frog Excel Audit — Full Issue Details\n\n"
    md += "| Issue Name | Issue Type | Priority | URLs | % of Total | Description | How To Fix | Help URL |\n"
    md += "|---|---|---|---|---|---|---|---|\n"

    # Sort rows by row number
    rows.sort(key=lambda x: x[0])

    for row_num, cells in rows:
        if row_num == 1:
            continue # Header row
        name = cells.get('A', '')
        itype = cells.get('B', '')
        prio = cells.get('C', '')
        urls = cells.get('D', '')
        pct = cells.get('E', '')
        desc = cells.get('F', '')
        fix = cells.get('G', '')
        help_url = cells.get('H', 'N/A') or 'N/A'
        
        # Clean up any newlines or formatting
        name = name.replace('\n', ' ').strip()
        itype = itype.replace('\n', ' ').strip()
        prio = prio.replace('\n', ' ').strip()
        desc = desc.replace('\n', ' ').strip()
        fix = fix.replace('\n', ' ').strip()
        
        md += f"| **{name}** | {itype} | {prio} | {urls} | {pct}% | {desc} | {fix} | {help_url} |\n"

    output_path = os.path.join('SEO Files', 'excel_issues_dump.md')
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(md)

    print("SUCCESS: Generated excel_issues_dump.md")
except Exception as e:
    print("Error parsing Excel:", e)
