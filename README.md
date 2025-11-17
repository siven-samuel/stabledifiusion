# Stable Diffusion - Kompletný setup

Tento priečinok obsahuje všetko potrebné pre spustenie Stable Diffusion aplikácie.

## 📁 Štruktúra

```
stabledifiuson/
├── sd-app/              # Vue.js frontend aplikácia
└── sd-backend/          # Python backend s Stable Diffusion modelom
```

## 🚀 Rýchly štart

### 1. Spustite Backend (Python)

```powershell
cd sd-backend
.\install.ps1          # Prvý krát - nainštaluje závislosti
.\start.ps1            # Spustí server ty ooooo
```

**Prvé spustenie:**
- Stiahne sa Stable Diffusion model (~4GB)
- Trvá 5-10 minút

**Požiadavky:**
- Python 3.10+
- NVIDIA GPU s CUDA (odporúčané)
- Alebo CPU (veľmi pomalé)

### 2. Spustite Frontend (Vue)

V druhom termináli:

```powershell
cd sd-app
yarn dev
```

Otvorte: `http://localhost:5173`

## 💻 Systémové požiadavky

### Minimálne:
- CPU: Intel i5 / AMD Ryzen 5
- RAM: 8GB
- Disk: 10GB voľného miesta
- Generovanie: 1-5 minút/obrázok

### Odporúčané:
- CPU: Intel i7 / AMD Ryzen 7
- RAM: 16GB
- GPU: NVIDIA RTX 3060+ (8GB VRAM)
- Disk: 10GB voľného miesta
- Generovanie: 5-15 sekúnd/obrázok

## 🎨 Použitie

1. Do poľa **Prompt** napíšte popis obrázka (anglicky)
2. **Negatívny prompt** - čo nechcete vidieť (voliteľné)
3. Kliknite **Generovať obrázok**
4. Počkajte 5-60 sekúnd (závisí od GPU/CPU)
5. Obrázok sa zobrazí v galérii

## 🔧 Riešenie problémov

### Backend nefunguje?

```powershell
cd sd-backend
venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

### Frontend nefunguje?

```powershell
cd sd-app
yarn install
yarn dev
```

### "Failed to fetch" chyba?

- Skontrolujte či Python backend beží
- URL: `http://localhost:5000`
- Otvorte v prehliadači: `http://localhost:5000/health`

### Pomalé generovanie?

- Normálne na CPU (1-5 minút)
- Nainštalujte CUDA pre GPU podporu
- Znížte kvalitu v `app.py`: `num_inference_steps=25`

## 📚 Viac info

- **Frontend**: `sd-app/README.md`
- **Backend**: `sd-backend/README.md`

## 🎯 Príklady promptov

```
- "A beautiful sunset over mountains, highly detailed, 8k"
- "Cyberpunk city at night, neon lights, rain, cinematic"
- "Oil painting of a cat, impressionist style"
- "Photorealistic portrait of a robot, studio lighting"
```

**Negatívne prompty:**
```
- "blurry, low quality, ugly, distorted"
- "bad anatomy, extra limbs, disfigured"
```

---

**Vyrobené s ❤️ pomocou Vue.js, Python a Stable Diffusion**
