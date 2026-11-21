# TM Opera O — AI Talker

Asisten AI pribadi berpersona **TM Opera O** dari Uma Musume. Bisa ngobrol (teks & suara), memantau layar (screenshot), memberi reminder otomatis, berbicara dengan suara hasil voice cloning RVC, dan punya **radial menu** — tampil sebagai **floating app** (frameless, selalu di atas) di Windows.

Lokasi project: `C:\Users\Jona\Documents\coding project\TM_Opera_O`

## Struktur Folder

```
TM_Opera_O/
├── webui_main.py           # ★ BACKEND UTAMA (pywebview + Gemini/Ollama + memory + TTS RVC + reminder)
├── Mulai Opera O.vbs       # ★ launcher tanpa jendela CLI (double-click)
├── web/
│   ├── index.html          # ★ frontend chat (Tailwind dark + gradien + animasi)
│   ├── radial.html         # ★ radial menu "bunga mekar" (logo Opera Crown)
│   └── icons/              # ikon icons8 (putih)
├── TM_Opera_O_GUI.py       # versi tkinter lama (floating app)
├── TM_Opera_O.py           # versi terminal (lama)
├── TM_Opera_O_TTS.py       # TTS standalone (ketik teks → suara Opera O)
├── rvc_server.py           # server konversi suara RVC (jalan di venv)
├── rvc_env/                # venv Python 3.10 + rvc-python
├── voice/                  # model RVC (uma-operao.pth + .index)
├── memory.json             # long-term memory (fakta tentang Lemon)
├── requirements.txt        # daftar package Python
├── .env                    # API key Gemini (JANGAN di-upload)
├── .env.example            # contoh .env
├── opera_profile.jpg       # foto profil Opera O
├── icons/                  # ikon dari icons8
└── README.md               # catatan ini
```

## Tech Stack

- **Backend**: Python + pywebview (jendela native WebView2, frameless + always-on-top)
- **Frontend**: HTML + Tailwind CSS (dark theme, gradien, animasi pop-in, typewriter, radial menu)
- **AI**: Google Gemini (`gemini-3.6-flash`) untuk chat & vision — **atau Ollama lokal** (`qwen2.5:1.5b`, gratis tanpa kuota)
- **Suara**: pyttsx3 (TTS dasar) → RVC (voice cloning suara Opera O)
- **Mic**: Web Speech API bawaan browser (tidak perlu pyaudio)

## Persona (Gen Z Hype + Multilingual Romance)

Opera O: egosentris, hiperbolik, ultimate hypeman Lemon. Gaya bicara campuran Indonesia-Inggris ala TikTok/Jaksel ("INILAH MY SUAMI AKU", "GILA MBG. MY BOY GW KEREN BANGETTT", "jujurly", "literally my king"). Panggilan multibahasa: **Mi amor, Mo chroi, Mon amour, Tesoro, My boy, Babe, Sayang**. Respon 1-3 kalimat, huruf kapital untuk hype. **"Trainer-san" dilarang**.

## Install

```bash
cd "C:\Users\Jona\Documents\coding project\TM_Opera_O"
pip install -r requirements.txt
```

Catatan: `python` di PC ini sudah diatur ke Python 3.12 (RVC pakai venv Python 3.10 terpisah di `rvc_env/`).

## Jalankan (Floating App — utama)

Cara termudah (tanpa jendela CLI): **double-click `Mulai Opera O.vbs`**.

Atau dari terminal:

```bash
cd "C:\Users\Jona\Documents\coding project\TM_Opera_O"
pythonw webui_main.py
```

Ada 2 jendela: **chat** (kanan layar) dan **radial menu** (lingkaran logo Opera, di kiri chat).

### Fitur chat
- **Bubble gradien**: kamu (pink→merah, kanan), Opera O (biru→ungu, kiri).
- **Indikator mengetik**: 3 titik animasi + "Opera O sedang mengetik...".
- **Animasi ketik**: jawaban keluar karakter per karakter dengan kursor berkedip.
- **Paperclip (tombol biru)** → menu: Mic, Lihat Layar, Tes Reminder, Ingat sesuatu, **Ganti Model**.
- **➖ / ✕** di header → minimize / sembunyikan chat (radial tetap hidup).

### Radial menu (bunga mekar)
Klik lingkaran logo Opera O → 5 tombol melesat keluar membentuk kipas setengah lingkaran (animasi bounce): **Mic, Lihat Layar, Tes Reminder, Ingat sesuatu, Buka Chat**.

## Ganti Model (Model Changer)

Menu → **Ganti Model**: pilih antara Gemini (`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-flash-latest`, dll) atau **`local:qwen2.5:1.5b`** (Ollama lokal). Model aktif tampil di status header.

## Model Lokal (Ollama) — gratis tanpa kuota

Ollama + `qwen2.5:1.5b` terpasang di PC ini (server `localhost:11434`).

- Tanpa kredit Gemini (solusi saat error 429 / kredit habis).
- Respon lebih lambat dari Gemini (jalan di CPU), tapi offline & gratis.
- Mode lokal: sliding window 10 pesan, persona khusus Gen Z dengan contoh jawaban, memory.json disuntik sebagai system prompt.
- Saat mode lokal aktif, fitur screenshot jadi komentar berbasis judul window (model 1.5B tanpa vision).

## Reminder, Activity Tracking & Habit Adaptation

Berjalan di background backend:
- **Reminder**: minum air (2 jam), stretching (3 jam), istirahat mata (4 jam) — toast + suara + bubble.
- **Protes saat diabaikan**: jika reminder diabaikan 3x berturut-turut, Opera O protes clingy ("Babe, literally kenapa aku di-ignore terus? My heart is broken loh!").
- **Activity tracking**: 45 menit di aplikasi yang sama → auto komentar (cooldown 90 menit, gaya diacak).
- **Dynamic Focus Mode**: jika terdeteksi di aplikasi produktivitas/game (VS Code, Illustrator, Valorant, dll), reminder dibungkam dan interval tracking direnggangkan ke 2 jam.
- Ubah daftar: edit `REMINDERS` / `FOCUS_KEYWORDS` di `webui_main.py`.

## Suara Opera O (RVC voice cloning)

Alur: TTS dasar (pyttsx3) → konversi RVC → putar suara Opera O.

- Model: `voice/uma-operao.pth` (RVC v2) + `voice/added_IVF1265_Flat_nprobe_1_uma-operao_v2.index`.
- Engine RVC jalan di `rvc_env/` (Python 3.10) lewat `rvc_server.py`.
- Fallback ke suara TTS biasa kalau RVC belum siap/error.

## Long-term memory

Fakta tentang kamu disimpan di `memory.json` dan disuntikkan ke persona. Otomatis diekstrak dari chat (tiap 5 menit, mode Gemini), atau manual lewat menu → "Ingat sesuatu".

## Startup otomatis

`TM_Opera_O_Startup.vbs` di folder Startup Windows → menjalankan `webui_main.py` saat login (tanpa console).

Nonaktifkan dengan menghapus:
```
C:\Users\Jona\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\TM_Opera_O_Startup.vbs
```

## Kustomisasi

- **Ganti foto profil**: timpa `opera_profile.jpg` (juga yang di `web/`).
- **Ganti logo radial**: timpa `web/opera_crown.png`.
- **Ganti warna/animasi UI**: edit `web/index.html` (chat) atau `web/radial.html` (radial).
- **Ganti persona**: `PERSONA_BASE` (Gemini) / `LOCAL_PERSONA` (Ollama) di `webui_main.py`.
- **Ganti model suara RVC**: timpa file di `voice/` lalu sesuaikan path di `rvc_server.py`.

## Troubleshooting

- **Error 429 "prepayment credits are depleted"** → kredit Gemini habis. Top up di https://ai.studio/projects, atau ganti ke model lokal (Ollama).
- Ollama tidak jalan → jalankan `ollama serve`, cek `http://localhost:11434`.
- API key tidak valid → cek `GEMINI_API_KEY` di `.env`.
- `python` mengarah ke 3.10 → gunakan `py -3.12` atau path penuh Python 3.12.
