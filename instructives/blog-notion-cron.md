# Blog Notion — export estático y cron en cPanel

Guía para mantener el blog de la landing: un **cron en el servidor** ejecuta un script **Python 3** que consulta la API de Notion y escribe un JSON estático; el sitio **solo lee ese archivo** (sin token ni API en el navegador).

## Resumen del flujo

```text
Notion (base de datos + bloques)
        ↓  cron cada hora (API server-side)
sync_notion_blog.py
        ↓
public_html/databases/blog_export.json
        ↓  fetch en el navegador
landing-page/js/blog.js → blog.html
```

| Rol | Ruta / componente |
|-----|-------------------|
| Token (fuera del web root) | `/home4/cbo109675/notion-secrets/notion_blog_token` |
| Script de sincronización | `/home4/cbo109675/bin/sync_notion_blog.py` |
| JSON publicado | `/home4/cbo109675/public_html/databases/blog_export.json` |
| Log del cron | `/home4/cbo109675/logs/notion_blog_cron.log` |
| Frontend (repo) | `landing-page/js/blog.js` → `databases/blog_export.json` |
| ID base de datos Notion | `3d10f8c9b2ed805b836fd9c4095acb9b` |
| Cabecera Notion-Version | `2022-06-28` |

**Importante:** nunca guardes el token de integración en este repositorio ni en markdown. Solo en el archivo del servidor con permisos restrictivos.

---

## 1. Token de integración Notion (una vez)

1. En [Notion → Integrations](https://www.notion.so/my-integrations), crea o reutiliza una integración con acceso de **lectura** a la base de datos del blog.
2. En Notion, abre la base de datos del blog → **⋯** → **Connections** → conecta esa integración.
3. En el servidor (SSH o Terminal de cPanel), crea el directorio y el archivo del token:

```bash
mkdir -p /home4/cbo109675/notion-secrets
chmod 700 /home4/cbo109675/notion-secrets
# Pega el token de la integración (ntn_...) sin espacios ni salto de línea extra:
printf '%s' 'PEGAR_TOKEN_DE_NOTION_AQUI' > /home4/cbo109675/notion-secrets/notion_blog_token
chmod 600 /home4/cbo109675/notion-secrets/notion_blog_token
```

Comprueba que el archivo no es legible por otros usuarios:

```bash
ls -la /home4/cbo109675/notion-secrets/
```

---

## 2. Crear o actualizar `sync_notion_blog.py`

En hosting compartido **no suele estar `jq`**. Usa la versión **Python 3** (stdlib: `urllib`, paginación, export con `pages` + `blocksByPageId`).

Copia y pega en SSH:

```bash
mkdir -p /home4/cbo109675/bin /home4/cbo109675/logs
cat > /home4/cbo109675/bin/sync_notion_blog.py << 'EOF'
#!/usr/bin/env python3
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone

TOKEN_PATH = "/home4/cbo109675/notion-secrets/notion_blog_token"
DATABASE_ID = "3d10f8c9b2ed805b836fd9c4095acb9b"
NOTION_VERSION = "2022-06-28"
OUT = "/home4/cbo109675/public_html/databases/blog_export.json"
API = "https://api.notion.com/v1"

def read_token():
    with open(TOKEN_PATH, "r", encoding="utf-8") as token_file:
        return token_file.read().strip()

def notion_request(method, path, body=None):
    url = API + path
    headers = {
        "Authorization": "Bearer " + read_token(),
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        payload = error.read().decode("utf-8", errors="replace")
        print(f"Notion {method} {path} failed HTTP {error.code}", file=sys.stderr)
        print(payload, file=sys.stderr)
        raise

def query_all_pages():
    pages = []
    cursor = None
    while True:
        body = {"page_size": 100}
        if cursor:
            body["start_cursor"] = cursor
        response = notion_request("POST", f"/databases/{DATABASE_ID}/query", body)
        pages.extend(response.get("results", []))
        if not response.get("has_more"):
            break
        cursor = response.get("next_cursor")
        if not cursor:
            break
    pages.sort(key=lambda page: page.get("last_edited_time") or "", reverse=True)
    return pages

def fetch_block_children(block_id):
    blocks = []
    cursor = None
    while True:
        path = f"/blocks/{block_id}/children?page_size=100"
        if cursor:
            from urllib.parse import quote
            path += "&start_cursor=" + quote(cursor, safe="")
        response = notion_request("GET", path)
        blocks.extend(response.get("results", []))
        if not response.get("has_more"):
            break
        cursor = response.get("next_cursor")
        if not cursor:
            break
    return {"object": "list", "results": blocks}

def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    pages = query_all_pages()
    blocks_by_page = {}
    for page in pages:
        page_id = page["id"]
        blocks_by_page[page_id] = fetch_block_children(page_id)
    exported = {
        "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pages": pages,
        "blocksByPageId": blocks_by_page,
    }
    temp_path = OUT + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as out_file:
        json.dump(exported, out_file, ensure_ascii=False)
    os.replace(temp_path, OUT)
    print("Wrote", OUT)

if __name__ == "__main__":
    main()
EOF
chmod 700 /home4/cbo109675/bin/sync_notion_blog.py
```

Formato esperado del JSON (lo valida `blog.js`):

- `exported_at`: ISO UTC
- `pages`: array de objetos página de Notion
- `blocksByPageId`: mapa `{ "page-uuid": { "object": "list", "results": [...] } }`

---

## 3. Ejecución manual

```bash
/usr/bin/python3 /home4/cbo109675/bin/sync_notion_blog.py
```

Salida esperada: `Wrote /home4/cbo109675/public_html/databases/blog_export.json`

Prueba rápida de token + base de datos (solo listado, sin bloques):

```bash
NOTION_TOKEN="$(cat /home4/cbo109675/notion-secrets/notion_blog_token)"
/usr/bin/curl -sS -X POST "https://api.notion.com/v1/databases/3d10f8c9b2ed805b836fd9c4095acb9b/query" \
  -H "Authorization: Bearer ${NOTION_TOKEN}" \
  -H "Notion-Version: 2022-06-28" \
  -H "Content-Type: application/json" \
  -d '{"page_size":1}' | head -c 500
```

Deberías ver JSON con `"object":"list"` y `"results":[...]`.

---

## 4. Cron en cPanel

1. **cPanel → Cron Jobs**
2. Frecuencia ejemplo: **cada hora** (`0 * * * *`)
3. Comando:

```text
0 * * * * /usr/bin/python3 /home4/cbo109675/bin/sync_notion_blog.py >> /home4/cbo109675/logs/notion_blog_cron.log 2>&1
```

Asegúrate de que exista el directorio de logs:

```bash
mkdir -p /home4/cbo109675/logs
```

Revisa el log tras la primera ejecución:

```bash
tail -50 /home4/cbo109675/logs/notion_blog_cron.log
```

**Nota:** existe un script bash antiguo `sync_notion_blog.sh` (curl + jq). En este host **no uses jq**; apunta el cron solo al `.py`. Puedes eliminar el `.sh` para evitar confusiones.

---

## 5. Verificar en producción

1. **JSON público** (sustituye el dominio si aplica):

   ```bash
   curl -sS "https://boycottdetect.org/databases/blog_export.json" | head -c 400
   ```

   Comprueba que `exported_at` se actualiza tras correr el script.

2. **Sitio:** abre `https://boycottdetect.org/blog.html` (o la URL del blog en tu docroot) y confirma listado y artículos.

3. Si el JSON es grande, en SSH:

   ```bash
   ls -lh /home4/cbo109675/public_html/databases/blog_export.json
   python3 -c "import json; json.load(open('/home4/cbo109675/public_html/databases/blog_export.json')); print('OK')"
   ```

---

## 6. Desarrollo local

El frontend no llama a Notion en local; necesitas una copia del export:

```bash
# Desde tu máquina, tras descargar el JSON del servidor o generarlo:
cp /ruta/al/blog_export.json /Users/juanpa/Documents/Bdetect/landing-page/databases/blog_export.json
```

Sirve la carpeta `landing-page` (Live Server, `python -m http.server`, etc.) y abre `blog.html`.  
`blog.js` pide `databases/blog_export.json` con `cache: 'no-cache'`.

---

## 7. Despliegue del sitio (git / FTP)

- **HTML, CSS, JS:** despliega `landing-page/` como siempre (push, rsync, cPanel Git, etc.).
- **`blog_export.json` en producción:** lo actualiza el **cron en el servidor**, no hace falta commitearlo en git si el archivo es muy grande o cambia cada hora.
- **Opcional en repo:** puedes mantener una copia reciente en `landing-page/databases/blog_export.json` solo para desarrollo local y previews; no es obligatorio para producción si el cron está activo.

Si usas un **dominio addon** con docroot distinto de `public_html`, cambia solo la constante `OUT` en el script Python para que el JSON quede en `{docroot}/databases/blog_export.json`.

---

## 8. Imágenes y URLs de Notion

Las URLs de archivos alojados en S3 de Notion (`prod-files-secure.s3...`) que vienen en el JSON **caducan aproximadamente a la hora**. Con cron horario, las miniaturas suelen verse bien en producción; si abres un JSON viejo en local o bajas la frecuencia del cron, pueden fallar imágenes.

**Mejora futura (no implementada):** en el sync, descargar imágenes a `public_html/assets/blog/` y reescribir URLs en el JSON, o usar solo URLs externas permanentes en Notion.

---

## 9. Solución de problemas

| Síntoma | Causa probable | Qué hacer |
|--------|----------------|-----------|
| `jq: no se encontró la orden` | Cron o script bash antiguo | Usar **solo** `sync_notion_blog.py` con Python 3 |
| `python3: command not found` en cron | PATH mínimo en cron | Usar ruta absoluta `/usr/bin/python3` (comprueba con `which python3` en SSH) |
| HTTP **401** | Token inválido o mal copiado | Regenerar token en Notion; reescribir archivo con `chmod 600` |
| HTTP **404** en database/blocks | ID incorrecto | Confirmar ID `3d10f8c9b2ed805b836fd9c4095acb9b` |
| HTTP **400** en query | Body inválido (p. ej. `sorts` en hosts viejos) | El script Python **no** envía `sorts`; ordena en memoria por `last_edited_time` |
| HTTP **403** / sin resultados | Integración sin acceso | Conectar la integración a la base de datos en Notion |
| Blog vacío en web | JSON ausente o 404 | Ejecutar script manual; verificar ruta bajo `public_html/databases/` |
| CORS en navegador | Intento de llamar API desde el frontend | **No** volver a exponer token en JS; mantener export estático |

Errores de Notion: el script imprime el cuerpo JSON del error en stderr; revisa también `notion_blog_cron.log`.

---

## 10. Enfoque obsoleto (no reintroducir)

Antes se probó cargar el blog **desde el navegador** contra la API de Notion, con **service worker** (`sw-notion-proxy.js`) y cliente (`notion-blog.js`), a veces pasando por un proxy CORS de terceros. Eso falla de forma fiable en producción por **CORS**, expone el token y depende de relays externos.

Ese código **fue eliminado** del repo. El diseño actual es:

- **Servidor:** cron + Python → `blog_export.json`
- **Cliente:** `js/blog.js` → solo `fetch` del JSON estático

No reañadas service workers ni tokens de integración en la landing salvo que implementes un **proxy propio en el mismo dominio** (Worker, PHP, etc.) — distinto del export estático documentado aquí.

---

## English quick reference

| Item | Value |
|------|--------|
| Purpose | Hourly cron runs Python sync; writes static JSON; `blog.js` renders it |
| Token file | `/home4/cbo109675/notion-secrets/notion_blog_token` (mode `600`, dir `700`) |
| Script | `/home4/cbo109675/bin/sync_notion_blog.py` |
| Output | `/home4/cbo109675/public_html/databases/blog_export.json` |
| Cron | `0 * * * * /usr/bin/python3 /home4/cbo109675/bin/sync_notion_blog.py >> /home4/cbo109675/logs/notion_blog_cron.log 2>&1` |
| Database ID | `3d10f8c9b2ed805b836fd9c4095acb9b` |
| Notion-Version | `2022-06-28` |
| Local dev | Copy `blog_export.json` into `landing-page/databases/` |
| Deprecated | Browser Notion API + service worker + third-party CORS proxy |
