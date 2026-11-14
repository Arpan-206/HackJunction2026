import { useEffect, useMemo, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, CylinderGeometry, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace, Vector3, type Group } from 'three';
import { createGoldLeafMaterial, getPlasterTextures } from '../three';

/** Waits for the display fonts so canvas-drawn lettering uses Cinzel and Garamond, not a fallback. */
function useFontsReady(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let live = true;
    Promise.all([document.fonts.load('700 200px Cinzel'), document.fonts.load('italic 500 60px "EB Garamond"')])
      .catch(() => undefined)
      .then(() => live && setOk(true));
    return () => {
      live = false;
    };
  }, []);
  return ok;
}

function lettering(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d') as CanvasRenderingContext2D);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A cast plaster score plaque standing on the bench, the score carved in Cinzel. */
export function ScorePlaque({ position, rotationY = 0, score, line, learned = false }: { position: [number, number, number]; rotationY?: number; score: string; line: string; learned?: boolean }) {
  const fonts = useFontsReady();
  const plaster = getPlasterTextures([0.6, 0.4]);
  const mats = useMemo(() => {
    const face = lettering(1024, 680, (ctx) => {
      ctx.fillStyle = '#EFEBE2';
      ctx.fillRect(0, 0, 1024, 680);
      ctx.strokeStyle = learned ? '#B8902F' : '#8C8778';
      ctx.lineWidth = learned ? 18 : 8;
      ctx.strokeRect(34, 34, 956, 612);
      ctx.fillStyle = '#1C1D24';
      ctx.textAlign = 'center';
      ctx.font = '700 330px Cinzel, Georgia, serif';
      ctx.fillText(score, 512, 380);
      ctx.font = 'italic 500 70px "EB Garamond", Georgia, serif';
      ctx.fillStyle = '#3A3C46';
      ctx.fillText(line, 512, 520);
    });
    const side = new MeshStandardMaterial({ color: '#E6E1D6', normalMap: plaster.normalMap, roughness: 0.95 });
    const front = new MeshStandardMaterial({ map: face, normalMap: plaster.normalMap, roughness: 0.92 });
    front.normalScale.set(0.3, 0.3);
    return { list: [side, side, side, side, front, side], face, front, side };
    // fonts flips once when Cinzel is ready, redrawing the lettering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, line, learned, plaster, fonts]);
  useEffect(
    () => () => {
      mats.face.dispose();
      mats.front.dispose();
      mats.side.dispose();
    },
    [mats],
  );
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.62, 0]} rotation={[-0.12, 0, 0]} material={mats.list}>
        <boxGeometry args={[1.6, 1.06, 0.1]} />
      </mesh>
      <mesh position={[0, 0.05, 0.06]} material={mats.side}>
        <boxGeometry args={[1.75, 0.1, 0.42]} />
      </mesh>
    </group>
  );
}

/** A lapis wax rank seal lying on the bench; gold leaf is laid into it only when a step is learned. */
export function WaxSeal({ position, rank, learned = false }: { position: [number, number, number]; rank: string; learned?: boolean }) {
  const fonts = useFontsReady();
  const built = useMemo(() => {
    const geo = new CylinderGeometry(0.42, 0.45, 0.09, 64, 1);
    const p = geo.attributes.position;
    const v = new Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const r = Math.hypot(v.x, v.z);
      if (r > 0.3) {
        // A blobby pressed-wax rim.
        const a = Math.atan2(v.z, v.x);
        const k = 1 + 0.06 * Math.sin(a * 7 + 1) + 0.035 * Math.sin(a * 13);
        p.setXYZ(i, v.x * k, v.y, v.z * k);
      }
    }
    geo.computeVertexNormals();
    const top = lettering(512, 512, (ctx) => {
      ctx.fillStyle = '#25358F';
      ctx.fillRect(0, 0, 512, 512);
      ctx.strokeStyle = '#3D52B8';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(256, 256, 190, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#E6E9FA';
      ctx.textAlign = 'center';
      ctx.font = '700 50px Cinzel, Georgia, serif';
      ctx.fillText(rank.toUpperCase(), 256, 274);
    });
    const wax = new MeshStandardMaterial({ color: '#2A3B98', roughness: 0.55, metalness: 0 });
    const face = new MeshStandardMaterial({ map: top, roughness: 0.7 });
    return { geo, wax, face, top, list: [wax, face, wax] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rank, fonts]);
  const gold = useMemo(() => (learned ? createGoldLeafMaterial() : null), [learned]);
  useEffect(
    () => () => {
      built.geo.dispose();
      built.wax.dispose();
      built.face.dispose();
      built.top.dispose();
      gold?.dispose();
    },
    [built, gold],
  );
  return (
    <group position={position}>
      {/* a small walnut stand holds the seal upright, facing the learner */}
      <mesh position={[0, 0.04, 0.02]} material={built.wax}>
        <boxGeometry args={[0.5, 0.08, 0.22]} />
      </mesh>
      <group position={[0, 0.5, 0]} rotation={[1.3, 0, 0]}>
        <mesh geometry={built.geo} material={built.list} rotation={[0, Math.PI / 2, 0]} />
        {gold && (
          <mesh position={[0, 0.05, 0]} rotation={[Math.PI / 2, 0, 0]} material={gold}>
            <torusGeometry args={[0.33, 0.04, 12, 64]} />
          </mesh>
        )}
      </group>
    </group>
  );
}

/** The streak candle: a beeswax candle in an iron dish, lit while the streak lives. */
export function StreakCandle({ position, lit = true }: { position: [number, number, number]; lit?: boolean }) {
  const mats = useMemo(
    () => ({
      wax: new MeshStandardMaterial({ color: '#EDE3CB', roughness: 0.6 }),
      iron: new MeshStandardMaterial({ color: '#2F2A26', roughness: 0.5, metalness: 0.6 }),
      flame: new MeshBasicMaterial({ color: '#FFD98A' }),
      core: new MeshBasicMaterial({ color: '#FFF6DC' }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  const [flame, setFlame] = useState<Group | null>(null);
  useFrame((st) => {
    if (flame) flame.scale.y = 1 + Math.sin(st.clock.elapsedTime * 9) * 0.06;
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.03, 0]} material={mats.iron}>
        <cylinderGeometry args={[0.26, 0.3, 0.06, 32]} />
      </mesh>
      <mesh position={[0, 0.36, 0]} material={mats.wax}>
        <cylinderGeometry args={[0.085, 0.09, 0.62, 24]} />
      </mesh>
      {lit && (
        <group ref={setFlame} position={[0, 0.75, 0]}>
          <mesh material={mats.flame} userData={{ noCast: true }}>
            <sphereGeometry args={[0.055, 16, 12]} />
          </mesh>
          <mesh position={[0, 0.06, 0]} material={mats.flame} userData={{ noCast: true }}>
            <coneGeometry args={[0.05, 0.14, 16]} />
          </mesh>
          <mesh position={[0, -0.01, 0.01]} material={mats.core} userData={{ noCast: true }}>
            <sphereGeometry args={[0.028, 12, 10]} />
          </mesh>
          <pointLight color="#FFC873" intensity={2.2} distance={3.2} decay={2} />
        </group>
      )}
    </group>
  );
}

