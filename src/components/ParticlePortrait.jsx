import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * ParticlePortrait
 * ------------------------------------------------------------------
 * Isla de React para Astro. Convierte una imagen en un campo de
 * partículas instanciadas (Three.js) que se dispersan y convergen en
 * la imagen al montarse.
 *
 * Uso en Astro:
 *   <ParticlePortrait client:only="react" imageSrc="/img/retrato.jpg" />
 *
 * Requisitos:
 *   npm install three
 *
 * `light`/`dark` quedan sin uso: las partículas ahora usan el RGB real de
 * la imagen en vez de mezclar esta paleta. Se conservan por si se quiere
 * volver al enfoque anterior (ver comentarios "color anterior").
 */
const PALETTE = {
  light: '#F4EFE6',   // tono crema claro -> píxeles brillantes
  dark: '#8A5A3B',    // warm-earth/terracota oscuro -> píxeles oscuros
  background: 'transparent',
};

const DARK_THRESHOLD = 34 / 255; // descarta píxeles más oscuros que esto (perf)

const VERTEX_SHADER = /* glsl */ `
  precision highp float;

  // RawShaderMaterial no inyecta estos automáticamente (a diferencia de ShaderMaterial)
  attribute vec3 position;
  attribute vec2 uv;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;

  attribute vec3 offset;
  attribute float pindex;
  attribute vec3 color; // RGB real del píxel, capturado al leer la imagen

  uniform float uTime;
  uniform float uRandom;
  uniform float uDepth;
  uniform float uSize;
  uniform float uProgress; // 0 = disperso, 1 = imagen formada
  uniform float uDispersion;

  varying vec2 vUv;
  varying vec3 vColor;

  // --- Enfoque anterior: escala de grises + mezcla con paleta (comentado) ---
  // varying float vGrey;
  // attribute float grey;

  float random(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  void main() {
    vUv = uv;
    vColor = color;
    // vGrey = grey; // color anterior

    // posición dispersa inicial: cada partícula parte en una dirección
    // aleatoria alejada de su posición final y converge al formarse la imagen
    float dx = random(pindex + 3.1) - 0.5;
    float dy = random(pindex + 7.7) - 0.5;
    float dz = random(pindex + 11.3) - 0.5;
    vec3 disperse = vec3(dx, dy, dz) * uDispersion * (1.0 - uProgress);

    vec3 displaced = offset + disperse;

    // desplazamiento aleatorio en x/y
    displaced.x += (random(pindex) - 0.5) * uRandom;
    displaced.y += (random(pindex + offset.x) - 0.5) * uRandom;

    // oscilación en z basada en tiempo
    float rndz = random(pindex) + sin(uTime * 0.5 + pindex);
    displaced.z += rndz * uDepth * random(pindex);

    // tamaño por partícula (brillo real del píxel + variación)
    float brightness = dot(color, vec3(0.21, 0.72, 0.07));
    float psize = (sin(uTime + pindex) * 0.4 + 1.0);
    psize *= max(brightness, 0.25);
    // psize *= max(grey, 0.25); // color anterior (escala de grises)
    psize *= uSize;

    vec3 vPosition = position * psize + displaced;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  // --- Paleta anterior (comentada): mezcla clara/oscura según escala de grises ---
  // uniform vec3 uColorLight;
  // uniform vec3 uColorDark;

  varying vec2 vUv;
  varying vec3 vColor;
  // varying float vGrey; // color anterior

  void main() {
    // círculo suave en vez de cuadrado
    float border = 0.3;
    float radius = 0.5;
    float dist = radius - distance(vUv, vec2(0.5));
    float alpha = smoothstep(0.0, border, dist);

    // color real del píxel de la imagen (sin mezcla de paleta)
    vec3 color = vColor;
    // vec3 color = mix(uColorDark, uColorLight, vGrey); // color anterior

    gl_FragColor = vec4(color, alpha);
  }
`;

// Utilidad del enfoque anterior (paleta light/dark). Se conserva por si se
// quiere volver a activar la mezcla de colores en vez del RGB real.
// function hexToVec3(hex) {
//   const c = new THREE.Color(hex);
//   return [c.r, c.g, c.b];
// }

export default function ParticlePortrait({
  imageSrc,
  className = '',
  particleSize = 1.2,
  randomness = 1.0,
  depth = 3.0,
  introDuration = 1.8,
}) {
  const containerRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    // En reduced-motion mostramos solo la imagen estática, sin WebGL.
    if (prefersReducedMotion) {
      const img = document.createElement('img');
      img.src = imageSrc;
      img.alt = '';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      container.appendChild(img);
      return () => container.removeChild(img);
    }

    let raf = 0;
    let destroyed = false;

    const scene = new THREE.Scene();
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(45, 1, 1, 10000);
    camera.position.z = 300;

    let particles = null;
    let introStart = null;
    let particlesReady = false;

    function maybeStartIntro() {
      if (particlesReady && introStart === null) {
        introStart = clock.getElapsedTime();
      }
    }

    // --- Construcción de las partículas a partir de la imagen
    const loader = new THREE.TextureLoader();
    loader.load(imageSrc, (texture) => {
      if (destroyed) return;

      const img = texture.image;
      const width = 160; // resolución de muestreo (no la resolución de la imagen final)
      const height = Math.round(width * (img.height / img.width));

      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = width;
      sampleCanvas.height = height;
      const sampleCtx = sampleCanvas.getContext('2d');
      sampleCtx.drawImage(img, 0, 0, width, height);
      const imgData = sampleCtx.getImageData(0, 0, width, height).data;

      const numPoints = width * height;

      // --- Enfoque anterior: escala de grises + mezcla con paleta (comentado) ---
      // let numVisible = 0;
      // const greys = new Float32Array(numPoints);
      // for (let i = 0; i < numPoints; i++) {
      //   const r = imgData[i * 4 + 0] / 255;
      //   const g = imgData[i * 4 + 1] / 255;
      //   const b = imgData[i * 4 + 2] / 255;
      //   const grey = r * 0.21 + g * 0.72 + b * 0.07;
      //   greys[i] = grey;
      //   if (grey > DARK_THRESHOLD) numVisible++;
      // }

      // primera pasada: guardamos el RGB real de cada píxel y contamos
      // cuántos superan el umbral (para no crear partículas sobre el fondo)
      let numVisible = 0;
      const pixelColors = new Float32Array(numPoints * 3);
      const brightness = new Float32Array(numPoints); // solo para filtrar fondo

      for (let i = 0; i < numPoints; i++) {
        const r = imgData[i * 4 + 0] / 255;
        const g = imgData[i * 4 + 1] / 255;
        const b = imgData[i * 4 + 2] / 255;
        pixelColors[i * 3 + 0] = r;
        pixelColors[i * 3 + 1] = g;
        pixelColors[i * 3 + 2] = b;
        brightness[i] = Math.max(r, g, b);
        if (brightness[i] > DARK_THRESHOLD) numVisible++;
      }

      const geometry = new THREE.InstancedBufferGeometry();
      geometry.instanceCount = numVisible;

      const positions = new THREE.BufferAttribute(new Float32Array(4 * 3), 3);
      positions.setXYZ(0, -0.5, 0.5, 0);
      positions.setXYZ(1, 0.5, 0.5, 0);
      positions.setXYZ(2, -0.5, -0.5, 0);
      positions.setXYZ(3, 0.5, -0.5, 0);
      geometry.setAttribute('position', positions);

      const uvs = new THREE.BufferAttribute(new Float32Array(4 * 2), 2);
      uvs.setXY(0, 0, 0);
      uvs.setXY(1, 1, 0);
      uvs.setXY(2, 0, 1);
      uvs.setXY(3, 1, 1);
      geometry.setAttribute('uv', uvs);

      geometry.setIndex(new THREE.BufferAttribute(new Uint16Array([0, 2, 1, 2, 3, 1]), 1));

      const indices = new Float32Array(numVisible);
      const offsets = new Float32Array(numVisible * 3);
      // const visibleGreys = new Float32Array(numVisible); // color anterior
      const colors = new Float32Array(numVisible * 3);

      for (let i = 0, j = 0; i < numPoints; i++) {
        // if (greys[i] <= DARK_THRESHOLD) continue; // filtro anterior (color anterior)
        if (brightness[i] <= DARK_THRESHOLD) continue;

        const x = (i % width) - width / 2;
        const y = Math.floor(i / width) * -1 + height / 2;

        offsets[j * 3 + 0] = x;
        offsets[j * 3 + 1] = y;
        offsets[j * 3 + 2] = 0;
        indices[j] = i;
        // visibleGreys[j] = greys[i]; // color anterior
        colors[j * 3 + 0] = pixelColors[i * 3 + 0];
        colors[j * 3 + 1] = pixelColors[i * 3 + 1];
        colors[j * 3 + 2] = pixelColors[i * 3 + 2];
        j++;
      }

      geometry.setAttribute('pindex', new THREE.InstancedBufferAttribute(indices, 1));
      geometry.setAttribute('offset', new THREE.InstancedBufferAttribute(offsets, 3));
      // geometry.setAttribute('grey', new THREE.InstancedBufferAttribute(visibleGreys, 1)); // color anterior
      geometry.setAttribute('color', new THREE.InstancedBufferAttribute(colors, 3));

      const material = new THREE.RawShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        depthTest: false,
        transparent: true,
        uniforms: {
          uTime: { value: 0 },
          uRandom: { value: randomness },
          uDepth: { value: depth },
          uSize: { value: particleSize },
          // uColorLight: { value: hexToVec3(PALETTE.light) }, // color anterior
          // uColorDark: { value: hexToVec3(PALETTE.dark) }, // color anterior
          uProgress: { value: 0 },
          uDispersion: { value: Math.max(width, height) * 1.2 },
        },
      });

      particles = new THREE.Mesh(geometry, material);
      scene.add(particles);

      camera.position.z = Math.max(width, height) * 1.1;
      particlesReady = true;
      maybeStartIntro();
    });

    function resize() {
      const { clientWidth, clientHeight } = container;
      renderer.setSize(clientWidth, clientHeight);
      camera.aspect = clientWidth / clientHeight;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener('resize', resize);

    const clock = new THREE.Clock();

    function animate() {
      if (destroyed) return;
      raf = requestAnimationFrame(animate);

      const elapsed = clock.getElapsedTime();

      if (particles) {
        particles.material.uniforms.uTime.value = elapsed;

        if (introStart !== null) {
          const t = Math.min((elapsed - introStart) / introDuration, 1);
          const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
          particles.material.uniforms.uProgress.value = eased;
        }
      }

      renderer.render(scene, camera);
    }
    animate();

    return () => {
      destroyed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
    };
  }, [imageSrc, particleSize, randomness, depth]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ width: '100%', height: '100%', background: PALETTE.background }}
    />
  );
}
