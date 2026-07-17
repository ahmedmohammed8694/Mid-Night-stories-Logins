import zipfile
import xml.etree.ElementTree as ET
import os

def docx_to_txt(docx_path):
    if not os.path.exists(docx_path):
        return f"Error: File {docx_path} does not exist."
    try:
        with zipfile.ZipFile(docx_path) as z:
            xml_content = z.read('word/document.xml')
            root = ET.fromstring(xml_content)
            
            # The namespace for Word XML elements
            w_namespace = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
            
            paragraphs = []
            # Find all paragraph elements
            for paragraph in root.iter(w_namespace + 'p'):
                texts = []
                # Find all text elements within the paragraph
                for node in paragraph.iter(w_namespace + 't'):
                    if node.text:
                        texts.append(node.text)
                if texts:
                    paragraphs.append(''.join(texts))
                else:
                    paragraphs.append('') # empty line for empty paragraphs
            return '\n'.join(paragraphs)
    except Exception as e:
        return f"Error parsing docx: {str(e)}"

docx_path = r"d:\My Applications\Webside\Midnight_Stories_Implementation_Plan_V1.01.docx"
text = docx_to_txt(docx_path)
with open(r"d:\My Applications\Webside\extracted_text_midnight.txt", "w", encoding="utf-8") as f:
    f.write(text)
print("Done extracting text to extracted_text_midnight.txt")
