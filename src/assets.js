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
    Object.entries(manifest.sprites).filter(([key]) => !key.startsWith('_')).map(async ([key, spec]) => {
      sprites[key] = { ...spec, image: await loadImage(base + spec.file) };
    }),
  );
  const layers = await Promise.all(
    manifest.background.layers.map(async (layer) => ({ ...layer, image: await loadImage(base + layer.file) })),
  );
  // Grandstands each track can choose from (see "stands" in data/tracks.json).
  const stands = {};
  await Promise.all(
    Object.entries(manifest.background.stands || {})
      .filter(([name]) => !name.startsWith('_'))
      .map(async ([name, spec]) => { stands[name] = await loadImage(base + spec.file); }),
  );
  return { manifest, sprites, layers, stands, cupStand: manifest.background.cupStand, view: manifest.raceView };
}
