from flask import Flask, request, jsonify
from flask_cors import CORS
import torch
from diffusers import StableDiffusionPipeline, StableDiffusionImg2ImgPipeline, DPMSolverMultistepScheduler, EulerAncestralDiscreteScheduler, EulerDiscreteScheduler
from PIL import Image
import io
import base64
import numpy as np
import os
from pathlib import Path
from remove_background import remove_black_background
from color_transform import shift_hue, adjust_saturation

app = Flask(__name__)
CORS(app)

# Priečinok pre LoRA modely
LORA_DIR = "./lora_models"

# Priečinok pre LoRA modely
LORA_DIR = "./lora_models"

# Pipelines map to support multiple models (loaded on demand)
pipelines = {
    # key -> { 'pipe': pipeline_obj, 'img2img': img2img_obj, 'version': str }
}

# Aktuálne načítaná LoRA (aby sme vedeli či treba unfuse)
current_lora = {
    'name': None,
    'scale': None
}

def get_available_loras():
    """Vráti zoznam dostupných LoRA modelov (aj v podpriečinkoch)"""
    if not os.path.exists(LORA_DIR):
        os.makedirs(LORA_DIR, exist_ok=True)
        return []
    
    loras = []
    for file in Path(LORA_DIR).rglob('*'):
        if file.suffix in ['.safetensors', '.pt', '.bin']:
            loras.append(file.stem)
    return loras

def find_lora_path(lora_name):
    """Nájde cestu k LoRA súboru podľa názvu (aj v podpriečinkoch)"""
    for ext in ['.safetensors', '.pt', '.bin']:
        for file in Path(LORA_DIR).rglob(f'{lora_name}{ext}'):
            return str(file)
    return None

def load_lora_to_pipeline(pipe_entry, lora_name, lora_scale=0.9):
    """
    Načíta LoRA do pipeline.
    Ak už je nejaká LoRA načítaná, najprv ju unfuse.
    """
    global current_lora
    
    if not lora_name:
        # Ak je lora_name prázdny, unfuse aktuálnu LoRA
        if current_lora['name']:
            print(f"🔄 Unfusing aktuálnu LoRA: {current_lora['name']}")
            try:
                pipe_entry['pipe'].unfuse_lora()
                pipe_entry['img2img'].unfuse_lora()
            except:
                pass  # Možno nie je načítaná
            current_lora['name'] = None
            current_lora['scale'] = None
        return
    
    lora_path = find_lora_path(lora_name)
    if not lora_path:
        raise FileNotFoundError(f"LoRA súbor nenájdený: {lora_name}")
    
    print(f"🎨 Načítavam LoRA: {lora_name} (scale={lora_scale})")
    
    # Unfuse predchádzajúcu LoRA ak existuje
    if current_lora['name']:
        print(f"🔄 Unfusing predchádzajúcu LoRA: {current_lora['name']}")
        try:
            pipe_entry['pipe'].unfuse_lora()
            pipe_entry['img2img'].unfuse_lora()
        except:
            pass
    
    # Načítaj novú LoRA
    pipe_entry['pipe'].load_lora_weights(lora_path)
    pipe_entry['pipe'].fuse_lora(lora_scale=lora_scale)
    
    pipe_entry['img2img'].load_lora_weights(lora_path)
    pipe_entry['img2img'].fuse_lora(lora_scale=lora_scale)
    
    current_lora['name'] = lora_name
    current_lora['scale'] = lora_scale
    
    print(f"✅ LoRA načítaná a fused s scale={lora_scale}")

MODEL_REGISTRY = {
    'lite': {
        'id': 'CompVis/stable-diffusion-v1-4',
        'description': 'LITE (SD v1.4) - menší, rýchlejší model',
    },
    'realistic': {
        'id': 'SG161222/Realistic_Vision_V5.1_noVAE',
        'description': 'Realistic Vision V5.1 - fotorealistické detaily, najlepšia kvalita',
    },
    'dreamshaper': {
        'id': 'Lykon/dreamshaper-8',
        'description': 'DreamShaper 8 - univerzálny, kvalitné detaily, mix štýlov',
    },
    'absolutereality': {
        'id': 'Lykon/absolute-reality-1.81',
        'description': 'Absolute Reality - podobný DreamShaper, semi-realistický',
    },
    'epicrealism': {
        'id': 'emilianJR/epiCRealism',
        'description': 'Epic Realism - blend reality & concept art, podobný DreamShaper',
    },
    'majicmix': {
        'id': 'digiplay/majicMIX_realistic_v7',
        'description': 'MajicMix Realistic - mix reality & fantasy, perfektný pre img2img',
    },
    'full': {
        'id': 'runwayml/stable-diffusion-v1-5',
        'description': 'Full (SD v1.5) - väčší, vyššia kvalita',
    }
}


def load_pipeline(key: str):
    """Načíta a vráti pipeline pre daný kľúč (lite/full). Nahráva sa on-demand."""
    global pipelines

    if key in pipelines:
        return pipelines[key]

    if key not in MODEL_REGISTRY:
        raise ValueError(f"Unknown model key: {key}")

    model_id = MODEL_REGISTRY[key]['id']
    device = 'cuda' if torch.cuda.is_available() else 'cpu'
    print(f"� Načítavam model '{key}' -> {model_id} na zariadenie: {device}")

    try:
        pipe = StableDiffusionPipeline.from_pretrained(
            model_id,
            torch_dtype=torch.float16 if device == 'cuda' else torch.float32,
            safety_checker=None,
            requires_safety_checker=False,
        )

        # Scheduler nastavenie - pre Realistic Vision použiť Euler
        if key == 'realistic':
            from diffusers import EulerAncestralDiscreteScheduler
            pipe.scheduler = EulerAncestralDiscreteScheduler.from_config(pipe.scheduler.config)
        elif key in ['dreamshaper', 'absolutereality', 'epicrealism', 'majicmix']:
            # Pre concept art modely použiť DDIM alebo Euler
            from diffusers import EulerDiscreteScheduler
            pipe.scheduler = EulerDiscreteScheduler.from_config(pipe.scheduler.config)
        else:
            pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)
        
        pipe = pipe.to(device)
        if device == 'cuda':
            pipe.enable_attention_slicing()
            # Pridaj optimalizácie pre 8GB VRAM
            if key in ['realistic', 'dreamshaper', 'absolutereality', 'epicrealism', 'majicmix']:
                print(f"⚡ Zapínam optimalizácie pre {key} (8GB VRAM)")
                pipe.enable_model_cpu_offload()  # Presúva modely medzi CPU/GPU
                # pipe.enable_vae_slicing()  # Voliteľné, ak stále nestačí RAM

        # Create img2img pipeline sharing components
        img2img = StableDiffusionImg2ImgPipeline(
            vae=pipe.vae,
            text_encoder=pipe.text_encoder,
            tokenizer=pipe.tokenizer,
            unet=pipe.unet,
            scheduler=pipe.scheduler,
            safety_checker=None,
            feature_extractor=pipe.feature_extractor,
        )
        img2img = img2img.to(device)

        pipelines[key] = {
            'pipe': pipe,
            'img2img': img2img,
            'version': key,
        }

        print(f"✅ Model '{key}' načítaný")
        return pipelines[key]

    except RuntimeError as oom:
        # GPU OOM or other runtime error
        print(f"❌ Chyba pri načítaní modelu '{key}': {oom}")
        raise
    except Exception as e:
        print(f"❌ Neočakovaná chyba pri načítaní modelu '{key}': {e}")
        raise

@app.route('/health', methods=['GET'])
def health():
    loaded = list(pipelines.keys())
    available_loras = get_available_loras()
    return jsonify({
        'status': 'ok',
        'models_loaded': loaded,
        'device': 'cuda' if torch.cuda.is_available() else 'cpu',
        'loras_available': available_loras,
        'current_lora': current_lora['name'],
    })

@app.route('/generate', methods=['POST'])
def generate():
    # model selection: 'lite' or 'full' (default: lite)
    model_key = (request.json or {}).get('model', 'lite')

    try:
        model_entry = load_pipeline(model_key)
    except Exception as e:
        return jsonify({'error': f'Nepodarilo sa načítať požadovaný model: {e}'}), 500
    
    try:
        data = request.json
        prompt = data.get('prompt', '')
        negative_prompt = data.get('negative_prompt', '')
        input_image = data.get('input_image', '')  # Base64 obrázok
        
        # LoRA podpora
        lora_name = data.get('lora', '')  # Názov LoRA (bez prípony)
        lora_scale = data.get('lora_scale', 0.9)  # 0.0 - 1.0
        
        # Načítaj LoRA ak je zadaná
        try:
            if lora_name and lora_name != current_lora['name']:
                load_lora_to_pipeline(model_entry, lora_name, lora_scale)
            elif not lora_name and current_lora['name']:
                # Unfuse ak už nie je potrebná
                load_lora_to_pipeline(model_entry, '', 0.0)
        except Exception as lora_err:
            print(f"⚠️  Chyba pri načítaní LoRA: {lora_err}")
            return jsonify({'error': f'Chyba pri načítaní LoRA: {lora_err}'}), 500
        
        # Limit steps for lite by default, but allow full to use higher default
        if model_key == 'lite':
            num_inference_steps = min(data.get('num_inference_steps', 30), 30)
        else:
            num_inference_steps = data.get('num_inference_steps', 50)
        guidance_scale = data.get('guidance_scale', 7.5)
        strength = data.get('strength', 0.75)  # Pre img2img - ako moc zmeniť obrázok
        
        # Rozmery obrázka (width, height)
        width = data.get('width', 512)
        height = data.get('height', 512)
        
        # Zaokrúhli na násobok 8 (požiadavka SD)
        width = int(width // 8 * 8)
        height = int(height // 8 * 8)
        
        if not prompt:
            return jsonify({'error': 'Prompt je povinný'}), 400
        
        # Image-to-Image ak je nahratý obrázok
        if input_image:
            print(f"🖼️ Image-to-Image ({model_key}): {prompt[:50]}...")

            # Dekóduj base64 obrázok
            if ',' in input_image:
                input_image = input_image.split(',')[1]

            image_data = base64.b64decode(input_image)
            init_image = Image.open(io.BytesIO(image_data))
            
            # Zachovaj alpha kanál pre neskoršie použitie
            has_alpha = False
            alpha_channel = None
            
            print(f"🖼️  Vstup: {init_image.mode}")
            if init_image.mode == 'RGBA':
                has_alpha = True
                alpha_channel = init_image.split()[3]  # Ulož alpha kanál
                print("   └─ Detekovaná priehľadnosť (RGBA)")
                # Konvertuj na RGB pre SD (s bielym pozadím pre preview)
                rgb_image = Image.new('RGB', init_image.size, (255, 255, 255))
                rgb_image.paste(init_image, mask=alpha_channel)
                init_image = rgb_image
            elif init_image.mode != 'RGB':
                init_image = init_image.convert('RGB')

            # Zmeniť veľkosť podľa požadovaných rozmerov
            target_size = (width, height)
            init_image = init_image.resize(target_size)
            if has_alpha:
                alpha_channel = alpha_channel.resize(target_size, Image.Resampling.LANCZOS)

            # Use the requested img2img pipeline
            img2img_pipe = model_entry.get('img2img')
            if img2img_pipe is None:
                return jsonify({'error': 'Img2Img pipeline nie je dostupná pre požadovaný model'}), 500

            with torch.inference_mode():
                image = img2img_pipe(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    image=init_image,
                    strength=strength,
                    num_inference_steps=num_inference_steps,
                    guidance_scale=guidance_scale,
                ).images[0]
            
            # Automaticky odstráň čierne pozadie a vytvor priehľadnosť
            if has_alpha:
                print("🔄 Odstraňujem čierne pozadie a vytvárám priehľadnosť...")
                # Odstráň čierne pozadie z vygenerovaného RGB obrázka
                image = remove_black_background(image, threshold=30)
            else:
                print("💡 Tip: Pre priehľadné pozadie nahrajte PNG s priehľadnosťou")
        
        # Text-to-Image ak nie je obrázok
        else:
            print(f"🎨 Text-to-Image ({model_key}): {prompt[:50]}... [{width}x{height}]")
            pipe = model_entry.get('pipe')
            if pipe is None:
                return jsonify({'error': 'Text-to-Image pipeline nie je dostupná pre požadovaný model'}), 500

            with torch.inference_mode():
                image = pipe(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    num_inference_steps=num_inference_steps,
                    guidance_scale=guidance_scale,
                    width=width,
                    height=height,
                ).images[0]
        
        buffer = io.BytesIO()
        image.save(buffer, format='PNG')
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        print("✅ Hotovo!")
        
        return jsonify({
            'image': f'data:image/png;base64,{img_base64}',
            'prompt': prompt
        })
        
    except Exception as e:
        print(f"❌ Chyba: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/remove-background', methods=['POST'])
def remove_background_endpoint():
    """Odstráni čierne pozadie z obrázka"""
    try:
        data = request.json
        image_data = data.get('image')
        threshold = data.get('threshold', 30)  # Nastaviteľný prah
        
        if not image_data:
            return jsonify({'error': 'Chýba obrázok'}), 400
        
        # Dekóduj base64 obrázok
        if 'base64,' in image_data:
            image_data = image_data.split('base64,')[1]
        
        image_bytes = base64.b64decode(image_data)
        image = Image.open(io.BytesIO(image_bytes))
        
        # Konvertuj na RGB ak je potrebné
        if image.mode == 'RGBA':
            # Ak už má alpha, konvertuj na RGB s bielym pozadím
            rgb_image = Image.new('RGB', image.size, (255, 255, 255))
            rgb_image.paste(image, mask=image.split()[3])
            image = rgb_image
        elif image.mode != 'RGB':
            image = image.convert('RGB')
        
        print(f"🔄 Odstraňujem čierne pozadie (prah: {threshold})...")
        
        # Odstráň čierne pozadie
        result_image = remove_black_background(image, threshold=threshold)
        
        # Konvertuj späť na base64
        buffer = io.BytesIO()
        result_image.save(buffer, format='PNG')
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        print("✅ Pozadie odstránené!")
        
        return jsonify({
            'image': f'data:image/png;base64,{img_base64}'
        })
        
    except Exception as e:
        print(f"❌ Chyba pri odstraňovaní pozadia: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/adjust-hue', methods=['POST'])
def adjust_hue_endpoint():
    """Zmení farebný odtieň obrázka bez straty kvality"""
    try:
        data = request.json
        image_data = data.get('image')
        hue_shift = data.get('hue_shift', 0)  # -180 až +180 stupňov
        
        if not image_data:
            return jsonify({'error': 'Chýba obrázok'}), 400
        
        # Dekóduj base64 obrázok
        if 'base64,' in image_data:
            image_data = image_data.split('base64,')[1]
        
        image_bytes = base64.b64decode(image_data)
        image = Image.open(io.BytesIO(image_bytes))
        
        print(f"🎨 Mením farebný odtieň (posun: {hue_shift}°)...")
        
        # Zmeň odtieň
        result_image = shift_hue(image, hue_shift)
        
        # Konvertuj späť na base64
        buffer = io.BytesIO()
        result_image.save(buffer, format='PNG')
        img_base64 = base64.b64encode(buffer.getvalue()).decode()
        
        print("✅ Odtieň zmenený!")
        
        return jsonify({
            'image': f'data:image/png;base64,{img_base64}'
        })
        
    except Exception as e:
        print(f"❌ Chyba pri zmene odtieňa: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 Stable Diffusion Backend (multi-model, on-demand)")
    print("=" * 60)
    # Pokusíme sa prednačítať LITE model pre rýchlejší start (ak je to možné)
    try:
        load_pipeline('lite')
        print("\n🌐 Prednačítaný LITE model (ak bol úspešne stiahnutý)")
    except Exception as e:
        print(f"\n⚠️  Nepodarilo sa prednačítať LITE model: {e}")

    print("\n🌐 Server pripravený!")
    print("📍 URL: http://localhost:5000")
    print("⚡ Podpora pre 'lite' a 'full' modely (na požiadanie)")
    print("=" * 60)
    app.run(host='0.0.0.0', port=5000, debug=False)
