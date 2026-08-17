import { MediaType } from '../types';

/**
 * Turns a plain-English idea into a detailed generation prompt, with no API call.
 *
 * The per-model differences below are not stylistic preference, they follow from the graphs in
 * workflowMapper.ts and how each sampler is configured there:
 *
 * - image_fast (Flux Schnell) runs at cfg 1.0. With CFG at 1 there is no classifier-free
 *   guidance, so the negative prompt has NO effect - offering one would be theatre. Flux also
 *   responds to flowing natural language rather than comma-separated tag soup, so this composes
 *   sentences for it.
 * - image_hd (SDXL) runs at cfg 7 with a real negative conditioning branch, so it gets
 *   comma-delimited descriptors, quality tags, and a matching negative prompt.
 * - video_short (SVD) has no CLIPTextEncode node in its graph at all. SVD is image-to-video and
 *   conditions purely on the start frame, so the text is stored with the job but never reaches
 *   ComfyUI. The honest move is to say so and help craft the STILL that seeds the video.
 */

export type PromptStyle =
  | 'photoreal'
  | 'cinematic'
  | 'illustration'
  | 'anime'
  | 'render3d'
  | 'product'
  | 'concept';

export interface PromptRequest {
  idea: string;
  mediaType: MediaType;
  aspectRatio: string;
  style: PromptStyle;
  /** Changing this re-rolls the discretionary choices without changing the idea. */
  seed?: number;
}

export interface CraftedPrompt {
  prompt: string;
  /** Undefined when the model cannot use one (Flux at cfg 1). */
  negativePrompt?: string;
  /** Things the user should know about this model, shown alongside the result. */
  notes: string[];
}

export const STYLE_LABELS: Record<PromptStyle, string> = {
  photoreal: 'Photorealistic',
  cinematic: 'Cinematic film still',
  illustration: 'Illustration',
  anime: 'Anime / manga',
  render3d: '3D render',
  product: 'Product shot',
  concept: 'Concept art',
};

interface StylePack {
  medium: string;
  lighting: string[];
  camera: string[];
  palette: string[];
  finish: string[];
}

const STYLE_PACKS: Record<PromptStyle, StylePack> = {
  photoreal: {
    medium: 'a photorealistic photograph',
    lighting: ['soft natural window light', 'golden-hour backlight', 'overcast diffused daylight', 'warm late-afternoon sun'],
    camera: ['shot on a 50mm lens at f/1.8, shallow depth of field', 'shot on an 85mm portrait lens, creamy bokeh', 'shot on a 35mm lens, natural perspective'],
    palette: ['natural muted colours', 'warm earthy tones', 'cool desaturated tones'],
    finish: ['fine skin and material texture', 'crisp micro-detail', 'true-to-life tonality'],
  },
  cinematic: {
    medium: 'a cinematic film still',
    lighting: ['dramatic low-key lighting with strong rim light', 'moody volumetric haze pierced by a single light source', 'high-contrast chiaroscuro lighting', 'cool blue ambience with a warm practical light'],
    camera: ['anamorphic widescreen framing, subtle lens flare', 'shallow-focus close-up on a long lens', 'wide establishing shot, deep staging'],
    palette: ['teal and amber grade', 'desaturated steel-blue grade', 'rich warm filmic grade'],
    finish: ['subtle film grain', 'filmic highlight rolloff', 'cinematic colour depth'],
  },
  illustration: {
    medium: 'a hand-painted digital illustration',
    lighting: ['soft ambient light with gentle bounce', 'warm rim lighting against a cool background', 'flat even light with graphic shadows'],
    camera: ['dynamic three-quarter composition', 'clean centred composition', 'slightly low angle for presence'],
    palette: ['harmonious limited palette', 'vivid saturated colour', 'soft pastel palette'],
    finish: ['visible brushwork', 'clean confident linework', 'painterly texture'],
  },
  anime: {
    medium: 'a high-quality anime illustration',
    lighting: ['bright key light with crisp cel shadows', 'sunset backlight with lens bloom', 'cool night lighting with neon accents'],
    camera: ['dynamic low-angle composition', 'close-up with expressive framing', 'wide scenic establishing composition'],
    palette: ['vibrant saturated colour', 'soft pastel colour', 'high-contrast neon palette'],
    finish: ['clean cel shading', 'detailed background art', 'sharp inked linework'],
  },
  render3d: {
    medium: 'a high-end 3D render',
    lighting: ['soft studio HDRI lighting', 'dramatic three-point studio lighting', 'moody rim-lit setup on a dark ground'],
    camera: ['orthographic-leaning hero angle', 'slight low angle, 50mm equivalent', 'top-down flat-lay framing'],
    palette: ['clean neutral palette with one accent colour', 'monochrome with metallic accents', 'bold complementary colours'],
    finish: ['physically based materials', 'ray-traced reflections and soft shadows', 'subsurface scattering detail'],
  },
  product: {
    medium: 'a professional product photograph',
    lighting: ['large softbox key with gentle gradient falloff', 'crisp studio lighting with controlled specular highlights', 'bright airy high-key lighting'],
    camera: ['centred hero shot on a 100mm macro lens', 'three-quarter hero angle, tight crop', 'straight-on elevation, perfectly level'],
    palette: ['clean seamless backdrop', 'soft neutral grey backdrop', 'complementary colour backdrop'],
    finish: ['immaculate surface detail', 'razor-sharp edges', 'commercial retouch quality'],
  },
  concept: {
    medium: 'a professional concept art piece',
    lighting: ['epic atmospheric light shafts', 'dramatic backlit silhouette lighting', 'diffused ambient light with heavy atmospheric depth'],
    camera: ['sweeping wide establishing composition', 'strong foreground-midground-background layering', 'dramatic low-angle scale shot'],
    palette: ['muted palette with one bold accent', 'cool atmospheric palette', 'warm dusty palette'],
    finish: ['confident graphic shape language', 'rich environmental storytelling detail', 'strong sense of scale'],
  },
};

// Only for models that actually apply negative conditioning (see the file header).
const NEGATIVE_BASE = [
  'blurry',
  'low quality',
  'jpeg artifacts',
  'watermark',
  'signature',
  'text',
  'deformed',
  'extra limbs',
  'bad anatomy',
  'oversaturated',
];

/** Stable, seed-varied choice - the same idea gives the same prompt until the user re-rolls. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function pick<T>(pool: T[], key: string): T {
  return pool[hash(key) % pool.length];
}

/**
 * Avoids telling the model something the user already said. Without this, an idea like
 * "golden hour portrait, 85mm" came back with a second, contradictory lighting and lens clause.
 */
function mentions(idea: string, terms: string[]): boolean {
  const lower = idea.toLowerCase();
  return terms.some((t) => lower.includes(t));
}

function compositionFor(aspectRatio: string): string {
  if (aspectRatio === '16:9') return 'wide horizontal composition with room to breathe on both sides';
  if (aspectRatio === '9:16') return 'tall vertical composition, subject filling the frame top to bottom';
  return 'balanced square composition, subject centred';
}

export function craftPrompt({ idea, mediaType, aspectRatio, style, seed = 0 }: PromptRequest): CraftedPrompt {
  const cleaned = idea.trim().replace(/\s+/g, ' ').replace(/[.]+$/, '');
  if (!cleaned) {
    return { prompt: '', notes: ['Describe your idea first - even a few words is enough to build on.'] };
  }

  const pack = STYLE_PACKS[style];
  const key = `${cleaned}|${style}|${aspectRatio}|${seed}`;

  // Skip any dimension the user already specified themselves.
  const parts: string[] = [];
  parts.push(`${pack.medium} of ${cleaned}`);

  if (!mentions(cleaned, ['light', 'lit', 'sunset', 'sunrise', 'golden hour', 'neon', 'shadow', 'backlit'])) {
    parts.push(pick(pack.lighting, key + 'light'));
  }
  if (!mentions(cleaned, ['mm', 'lens', 'close-up', 'closeup', 'wide shot', 'angle', 'aerial', 'macro'])) {
    parts.push(pick(pack.camera, key + 'cam'));
  }
  if (!mentions(cleaned, ['colour', 'color', 'palette', 'monochrome', 'black and white'])) {
    parts.push(pick(pack.palette, key + 'pal'));
  }
  parts.push(compositionFor(aspectRatio));
  parts.push(pick(pack.finish, key + 'fin'));

  const notes: string[] = [];

  if (mediaType === 'video_short') {
    // The graph has no text encoder - see the file header. Redirect the effort somewhere useful.
    notes.push(
      'Quantized SVD is image-to-video and has no text encoder in its workflow, so this text will NOT influence the video.'
    );
    notes.push(
      'Use this prompt with Flux or SDXL first to generate a strong start frame, then upload that image and render the video from it.'
    );
    notes.push('Motion comes from the workflow itself (16 frames at 8 fps, motion bucket 127), not from words.');
    return { prompt: parts.join(', '), notes };
  }

  if (mediaType === 'image_fast') {
    // Flux: flowing prose, and no negative prompt because cfg 1.0 ignores it.
    const prose = `${parts[0]}. ${parts.slice(1).join('. ')}.`;
    notes.push('Flux Schnell runs at CFG 1.0, where negative prompts have no effect - so none is generated.');
    notes.push('Flux responds to natural descriptive sentences rather than keyword lists, which is what this produces.');
    return { prompt: prose.replace(/\.\./g, '.'), notes };
  }

  // SDXL: comma-delimited descriptors plus quality tags, and a real negative prompt.
  const tags = [...parts, 'highly detailed', 'sharp focus', 'professional quality', '8k'];
  notes.push('SDXL runs at CFG 7 with real negative conditioning, so a matching negative prompt is included.');
  notes.push('Renders at 1024x1024 (or 1280x720 / 720x1280) - detail tags help at this resolution.');
  return {
    prompt: tags.join(', '),
    negativePrompt: NEGATIVE_BASE.join(', '),
    notes,
  };
}
