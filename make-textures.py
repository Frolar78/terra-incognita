# Génère les textures tuilables du jeu (exécuté une fois ; les PNG sont
# livrés dans assets/textures/). Bruit fractal par synthèse spectrale FFT
# => tuilable par construction.
import numpy as np
from PIL import Image

rng = np.random.default_rng(42)

def fractal_noise(size, beta=2.2, seed=None):
    r = np.random.default_rng(seed)
    f = np.fft.fftfreq(size)
    fx, fy = np.meshgrid(f, f)
    freq = np.sqrt(fx * fx + fy * fy)
    freq[0, 0] = 1e-6
    amp = 1.0 / (freq ** beta)
    phase = r.uniform(0, 2 * np.pi, (size, size))
    spec = amp * np.exp(1j * phase)
    img = np.real(np.fft.ifft2(spec))
    img -= img.min()
    img /= img.max()
    return img

# --- Parchemin 1024, tuilable -------------------------------------------
S = 1024
base = np.array([234, 224, 198], float)          # #EAE0C6
blotch = fractal_noise(S, 3.0, 1)                # taches larges
fiber = fractal_noise(S, 1.6, 2)                 # fibres fines
grain = np.random.default_rng(3).normal(0, 1, (S, S))
grain = (grain - grain.min()) / (grain.max() - grain.min())

v = 0.62 * blotch + 0.28 * fiber + 0.10 * grain  # 0..1
v = (v - v.min()) / (v.max() - v.min())
shade = 0.86 + 0.20 * v                          # 0.86..1.06
img = np.clip(base[None, None, :] * shade[:, :, None], 0, 255)
# taches d'encre éparses, brun sombre
ink = fractal_noise(S, 3.4, 7)
mask = np.clip((ink - 0.80) / 0.20, 0, 1) ** 2
inkcol = np.array([110, 92, 66], float)
img = img * (1 - 0.35 * mask[:, :, None]) + inkcol[None, None, :] * 0.35 * mask[:, :, None]
Image.fromarray(img.astype(np.uint8), 'RGB').save('assets/textures/parchemin.png', optimize=True)

# --- Bruits de brume 512, tuilables, en niveaux de gris ------------------
for name, beta, seed in (('brume1', 2.6, 11), ('brume2', 2.0, 23)):
    n = fractal_noise(512, beta, seed)
    n = 0.55 + 0.45 * n                          # jamais totalement noir
    Image.fromarray((n * 255).astype(np.uint8), 'L').save(f'assets/textures/{name}.png', optimize=True)

# --- Bruit de déformation des bords (petit, tuilable) --------------------
d = fractal_noise(256, 1.8, 31)
Image.fromarray((d * 255).astype(np.uint8), 'L').save('assets/textures/deform.png', optimize=True)

print('textures OK')
