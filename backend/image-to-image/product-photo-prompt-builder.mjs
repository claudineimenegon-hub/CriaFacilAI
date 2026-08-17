import {
  createProductIdentitySpecification,
  summarizeProductIdentitySpecification,
} from './product-identity-spec.mjs';
import {
  createProductFidelityPolicy,
  summarizeProductFidelityPolicy,
} from './product-fidelity-policy.mjs';

const MAX_PROMPT_LENGTH = 2048;
const USER_BRIEF_BUDGET = 258;

const objectiveDirections = {
  'Estúdio Premium': 'disciplined premium studio campaign treatment',
  Lifestyle: 'believable aspirational commercial storytelling',
  Luxo: 'understated luxury with category-appropriate materials',
  'E-commerce': 'commercial readability and accurate product visibility',
  Cinematográfico: 'dimensional cinematic atmosphere without obscuring the product',
  'Social Media': 'immediate focal point for a polished social campaign',
};

const preservationInstructions = {
  preserveProduct: 'product', preservePackaging: 'package',
  preserveLabel: 'label', preservePrintedText: 'printed text',
  preserveLogo: 'logo', preserveColors: 'colors/material tones',
  preserveProportions: 'geometry/proportions',
  preserveFace: 'face/identity', preserveClothing: 'clothing',
};

const categoryPlacement = {
  jewelry: '',
  accessory: 'wear, carry, hold, or display only as physically intended',
  clothing: 'use plausible anatomy, fit, garment construction, and body alignment',
  footwear: 'place on the correct foot position or show isolated',
  cosmetic: 'hold or apply with plausible hand anatomy and application area',
  perfume: 'hold or apply naturally; never attach the bottle to a body',
  beverage: 'hold, pour, serve, or display with realistic scale and grip',
  food: 'serve, cut, hold, or consume plausibly; never wear or attach to a body',
  electronics: 'show realistic operation, grip, installation, or placement',
  furniture: 'keep architectural scale, support, contact, and interaction realistic',
  automotive: 'keep vehicle scale, road contact, orientation, and occupants realistic',
  general: 'keep scale, orientation, support, contact, and quantity realistic',
};

const operationalDirections = {
  'LIFESTYLE / WORN IN USE': 'Create a new editorial ad with a person wearing the product correctly; use campaign framing and a scene unlike the reference photo.',
  'LIFESTYLE / HELD OR APPLIED': 'Create a new lifestyle ad showing credible handling or application; keep the product unobstructed and dominant.',
  'LUXURY DISPLAY': 'Create a fully re-staged luxury still life without a model, using a new premium surface, set, composition, and lighting.',
  'EXTREME MACRO': 'Create a significantly closer commercial macro focused on real finish, texture, material, color, reflections, and construction.',
  'CONCEPT CAMPAIGN': 'Create a sophisticated campaign key visual with a unique composition, not reference framing.',
  'PRODUCT HERO': 'Create a newly staged hero advertisement with the complete product dominant and a deliberate commercial composition.',
  'CLEAN CATALOG': 'Create a new accurate e-commerce photograph with a clean silhouette, corrected perspective, and dimensional studio light.',
  'FUNCTIONAL USE CONTEXT': 'Create a new realistic use scene that clearly demonstrates the product function and keeps it visually dominant.',
  'TECHNICAL DETAIL': 'Create a new technical advertising close-up revealing authentic construction, controls, joints, or materials.',
  'FOOD HERO': 'Create a new appetizing food hero photograph without turning the advertised product into a different item.',
  'SERVING / CONSUMPTION CONTEXT': 'Create a new plausible serving scene while keeping the original advertised product identifiable.',
  'ENVIRONMENTAL CONTEXT': 'Create a new environmental advertisement with realistic scale and a category-appropriate fully designed setting.',
  'MOTION / ACTION': 'Create a new action advertisement with functionally plausible motion while the product identity stays sharp.',
  'EDITORIAL STILL LIFE': 'Create a new aspirational still life with an independent art-directed composition and restrained color story.',
  'GIFT / NEUTRAL PACKAGING PRESENTATION': 'Create a new gift presentation using neutral, unbranded, text-free packaging.',
};

function clip(value, maxLength) {
  const text = String(value).trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function restrictiveMode(preservation) {
  if (preservation.changeBackgroundOnly) {
    return 'MODE — BACKGROUND ONLY: change only the background; preserve product, framing, camera, composition, and lighting. Do not freely re-stage.';
  }
  if (preservation.changeLightingOnly) {
    return 'MODE — LIGHTING ONLY: change only lighting; preserve product, background, scene, camera, framing, and composition. Do not freely re-stage.';
  }
  if (preservation.changeSceneOnly) {
    return 'MODE — SCENE ONLY: change only the surroundings; preserve the product and its physical placement. Do not freely redesign it.';
  }
  return null;
}

function transformationDirection(preservation) {
  return restrictiveMode(preservation) ?? [
    'FREE RE-STAGING:',
    'Change composition, background, camera/framing, lighting, perspective and scene relationship.',
    'Never return a cleaned-up reference copy.',
  ].join(' ');
}

function globalConstraints({ allowCollage, allowText }) {
  return [
    'CONSTRAINTS: correct anatomy; no impossible/floating placement, deformed body, duplicates.',
    allowCollage
      ? 'Use only the coherent multi-image layout explicitly requested.'
      : 'One ad photo; no moodboard/contact sheet/split screen/grid/collage/panels.',
    allowText
      ? 'Use exact requested text only; invent no other typography/branding.'
      : 'No typography, caption, logo, brand, watermark, label, invented text.',
    'Product primary; model supports it.',
  ].join(' ');
}

function physicalFidelity(preservation, policy) {
  const protections = Object.entries(preservationInstructions)
    .filter(([key]) => preservation[key] === true)
    .map(([, instruction]) => instruction);
  const requested = protections.length > 0 ? protections.join(', ') : 'identity, geometry, materials, colors, distinctive details';
  return [
    `FIDELITY (BEST EFFORT): same product — ${requested}; no redesign.`,
    summarizeProductFidelityPolicy(policy),
  ].join(' ');
}

function visibilityDirection(visibilityIntent) {
  const { mode, selection, allowPartialVisibility } = visibilityIntent;
  return [
    `VISIBILITY INTENT: ${mode}; ${selection}.`,
    allowPartialVisibility
      ? 'Justified subset/occlusion/partial view allowed.'
      : 'Show selected product clearly when physically plausible.',
    'Visibility never changes source inventory or product identity.',
  ].join(' ');
}

export class ProductPhotoPromptBuilder {
  build({
    prompt,
    preservation = {},
    artisticDirection,
    plan,
    concept,
    identitySpecification,
    fidelityPolicy,
  }) {
    if (!plan?.understanding || !concept?.visibilityIntent) {
      throw new TypeError('A product understanding and planned concept are required.');
    }
    const userBrief = clip(prompt, USER_BRIEF_BUDGET);
    const category = plan.understanding.category;
    const identity = identitySpecification ?? createProductIdentitySpecification({
      category,
      preservation,
    });
    const policy = fidelityPolicy ?? createProductFidelityPolicy({ category });
    const objective = objectiveDirections[artisticDirection] ??
      'realistic, commercially useful advertising treatment';
    const compact = userBrief.length > 180 ||
      Object.values(preservation).filter((value) => value === true).length > 4;
    const categoryInteraction = category === 'jewelry'
      ? ''
      : `; ${clip(categoryPlacement[category] ?? categoryPlacement.general, 75)}`;
    const sections = [
      'REFERENCE: INPUT IMAGE 0 defines the product.',
      summarizeProductIdentitySpecification(identity),
      physicalFidelity(preservation, policy),
      `USER BRIEF: ${userBrief}`,
      transformationDirection(preservation),
      `CONCEPT: ${concept.name}. ${clip(operationalDirections[concept.name] ?? concept.objective, compact ? 68 : 120)} Intent: ${clip(concept.objective, compact ? 24 : 45)}; ${clip(objective, 55)}.`,
      `INTERACTION: product${concept.humanPresent ? ' with supporting person' : ' alone'}; ${clip(concept.interaction, compact ? 34 : 58)}${compact ? '' : categoryInteraction}.`,
      visibilityDirection(concept.visibilityIntent),
      `COMPOSITION: ${clip(`${concept.cameraDistance}; ${concept.angle}; ${concept.lens}; ${concept.composition}`, compact ? 66 : 104)}.`,
      `LIGHTING/DEPTH: ${clip(`${concept.lighting}; ${concept.depthOfField}`, compact ? 46 : 76)}.`,
      compact
        ? null
        : `MATERIAL/SET: ${clip(plan.understanding.materialDirection, 54)}; ${clip(concept.environment, 44)}.`,
      compact
        ? 'QUALITY: sharp commercial photo; realistic materials; no washed-out/plastic/CGI look.'
        : 'QUALITY: sharp commercial photo; dimensional light, controlled highlights; no washed-out/plastic/CGI look.',
      globalConstraints(plan.understanding),
    ].filter(Boolean);
    const finalPrompt = sections.join('\n');
    if (finalPrompt.length > MAX_PROMPT_LENGTH) {
      throw new RangeError(`Product photo prompt has ${finalPrompt.length} characters; maximum is ${MAX_PROMPT_LENGTH}.`);
    }
    return finalPrompt;
  }
}

export const PRODUCT_PHOTO_PROMPT_LIMIT = MAX_PROMPT_LENGTH;
export const PRODUCT_PHOTO_USER_BRIEF_BUDGET = USER_BRIEF_BUDGET;
