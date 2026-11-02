// Loads assets/manifest.json and every image it lists.
// Swapping art never needs a code change: edit the PNGs (or the manifest).

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

export async function loadAssets(base = 'assets/') {
  const manifest = await (await fetch(`${base}manifest.json`)).json();
  const sprites = {};
  await Promise.all(
    Object.entries(manifest.sprites).map(async ([key, spec]) => {
      sprites[key] = { ...spec, image: await loadImage(base + spec.file) };
    }),
  );
  const layers = await Promise.all(
    manifest.background.layers.map(async (layer) => ({ ...layer, image: await loadImage(base + layer.file) })),
  );
  return { manifest, sprites, layers, view: manifest.raceView };
}
