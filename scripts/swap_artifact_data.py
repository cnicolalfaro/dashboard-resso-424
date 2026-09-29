#!/usr/bin/env python3
"""
A partir del HTML completo devuelto por 'Artifact action=read' (que trae un
esqueleto <html><head>...</head><body>...</body></html> agregado por la
herramienta al publicar), extrae solo el contenido interno (el que hay que
volver a publicar, SIN esqueleto) y reemplaza el bloque `const DATA = {...};`
por el nuevo snapshot.

Uso:
    python3 swap_artifact_data.py <html_leido_in> <new_data_json> <html_a_publicar_out>
"""
import sys, re, json


def main():
    if len(sys.argv) != 4:
        print("RESULT_ERROR uso: swap_artifact_data.py <html_in> <new_data_json> <html_out>")
        sys.exit(1)
    html_in_path, new_data_path, html_out_path = sys.argv[1:4]

    html = open(html_in_path, encoding='utf-8').read()
    new_data = json.load(open(new_data_path, encoding='utf-8'))

    m_body_open = re.search(r'<body[^>]*>', html, re.IGNORECASE)
    idx_body_close = html.rfind('</body>')
    if not m_body_open or idx_body_close == -1 or idx_body_close <= m_body_open.end():
        print("RESULT_ERROR no se encontro un esqueleto <body>...</body> reconocible en el HTML leido")
        sys.exit(1)
    inner = html[m_body_open.end():idx_body_close].strip('\n')

    pattern = re.compile(r'const DATA = \{.*?\};', re.DOTALL)
    if not pattern.search(inner):
        print("RESULT_ERROR no se encontro 'const DATA = {...};' dentro del contenido del artifact")
        sys.exit(1)

    new_data_js = 'const DATA = ' + json.dumps(new_data, ensure_ascii=False) + ';'
    inner_new, n = pattern.subn(new_data_js, inner, count=1)
    if n != 1:
        print("RESULT_ERROR reemplazo de DATA fallo de forma inesperada")
        sys.exit(1)

    with open(html_out_path, 'w', encoding='utf-8') as f:
        f.write(inner_new)

    print(f"RESULT_OK bytes_out={len(inner_new)}")


if __name__ == '__main__':
    main()
