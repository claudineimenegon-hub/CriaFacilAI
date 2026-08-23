import { V3_CAMPAIGN_ROLES, V3_COLOR_STRATEGIES, V3_HUMAN_PRESENCE } from './creative-director-v3.mjs';
import { prepareCreativeDirectorV3SourceImage } from './creative-director-v3-source-image.mjs';

export const OPENAI_CREATIVE_DIRECTOR_V3_MODEL = 'gpt-5.4-mini';
export const OPENAI_RESPONSES_ENDPOINT = 'https://api.openai.com/v1/responses';
export const OPENAI_CREATIVE_DIRECTOR_V3_TIMEOUT_MS = 120_000;

const string = { type: 'string', minLength: 2 };
const nullableString = { anyOf: [string, { type: 'null' }] };
const stringArray = { type: 'array', items: string };
const itemQuantity = {
  type: 'object', additionalProperties: false, required: ['itemId', 'quantity'],
  properties: { itemId: string, quantity: { type: 'integer', minimum: 1 } },
};

const creativeBriefSchema = {
  type: 'object', additionalProperties: false,
  required: ['proposalId', 'campaignRole', 'campaignIdea', 'commercialObjective', 'visualStory',
    'productPresentation', 'visibilityIntent', 'humanInteraction', 'scene', 'artDirection',
    'photography', 'creativeFreedom', 'luxuryCues', 'differentiationKeys', 'fidelityRequirements'],
  properties: {
    proposalId: { type: 'integer', minimum: 1, maximum: 4 },
    campaignRole: { type: 'string', enum: V3_CAMPAIGN_ROLES },
    campaignIdea: string, commercialObjective: string, visualStory: string,
    productPresentation: {
      type: 'object', additionalProperties: false,
      required: ['heroItemIds', 'supportingItemIds', 'requiredVisibleItems', 'optionalVisibleItems', 'presentationMode'],
      properties: {
        heroItemIds: stringArray, supportingItemIds: stringArray,
        requiredVisibleItems: { type: 'array', items: itemQuantity },
        optionalVisibleItems: { type: 'array', items: itemQuantity }, presentationMode: string,
      },
    },
    visibilityIntent: {
      type: 'object', additionalProperties: false,
      required: ['mode', 'requiredVisibleItems', 'optionalVisibleItems', 'heroItemIds', 'pairPolicy'],
      properties: {
        mode: string, requiredVisibleItems: { type: 'array', items: itemQuantity },
        optionalVisibleItems: { type: 'array', items: itemQuantity }, heroItemIds: stringArray, pairPolicy: string,
      },
    },
    humanInteraction: {
      type: 'object', additionalProperties: false, required: ['presence', 'mode', 'usageDescription'],
      properties: { presence: { type: 'string', enum: V3_HUMAN_PRESENCE }, mode: { type: 'string', enum: ['required', 'allowed', 'forbidden'] }, usageDescription: nullableString },
    },
    scene: {
      type: 'object', additionalProperties: false,
      required: ['environment', 'surface', 'foreground', 'midground', 'background', 'props'],
      properties: { environment: string, surface: string, foreground: string, midground: string, background: string, props: stringArray },
    },
    artDirection: {
      type: 'object', additionalProperties: false,
      required: ['visualLanguage', 'colorStrategy', 'palette', 'materials', 'styling', 'atmosphere'],
      properties: {
        visualLanguage: string, colorStrategy: { type: 'string', enum: V3_COLOR_STRATEGIES },
        palette: stringArray, materials: stringArray, styling: string, atmosphere: string,
      },
    },
    photography: {
      type: 'object', additionalProperties: false,
      required: ['shotType', 'cameraAngle', 'framing', 'lensLanguage', 'depthOfField', 'lighting', 'contrast'],
      properties: { shotType: string, cameraAngle: string, framing: string, lensLanguage: string, depthOfField: string, lighting: string, contrast: string },
    },
    creativeFreedom: {
      type: 'object', additionalProperties: false, required: ['sceneTransformation', 'productTransformation'],
      properties: { sceneTransformation: { type: 'string', enum: ['high'] }, productTransformation: { type: 'string', enum: ['forbidden'] } },
    },
    luxuryCues: stringArray, differentiationKeys: stringArray, fidelityRequirements: stringArray,
  },
};

export const OPENAI_CREATIVE_DIRECTOR_V3_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['briefs'],
  properties: { briefs: { type: 'array', minItems: 4, maxItems: 4, items: creativeBriefSchema } },
});

const SYSTEM_INSTRUCTIONS = [
  'You are a senior advertising creative director, art director, commercial photographer and visual brand strategist.',
  'Return exactly four concrete, product-specific campaign briefs matching the supplied JSON Schema.',
  'The required campaign roles are hero_commercial, contextual_lifestyle, editorial_craft_detail and concept_campaign, once each.',
  'These roles are advertising functions, not reusable visual templates. Make each campaign materially different in environment, presentation, photography, lighting, color and visual language.',
  'Transform the world around the product, not the identity of the product.',
  'The optional SOURCE IMAGE is visual evidence and creative inspiration only. PRODUCT IDENTITY is the canonical factual authority and always wins if visual interpretation appears to conflict with it.',
  'Use the source to understand observable silhouette, proportions, finish, texture, colors, contrast, design language and opportunities for composition, lighting and detail. Do not infer hidden or unsupported characteristics.',
  'Derive concrete product-specific art direction from observable visual character. Design the environmental palette to support the real product colors; never recolor the product to fit the environment.',
  'Canonical item IDs, functional types, quantities, relationships, observed materials, observed colors and distinctive structures are immutable.',
  'Canonical relationships are operational locks: copy every relationship type and item ID exactly; never rename, reinterpret, recreate, omit when required or replace canonical IDs with descriptive IDs.',
  'For a canonical pair required by a proposal, retain its complete canonical quantity and set pairPolicy to preserve_pair. Never invent explicit_single_instance unless the supplied V3 contract explicitly authorizes it.',
  'Keep requiredVisibleItems, optionalVisibleItems and pairPolicy mutually coherent. Do not create new relationships or remove a known relationship when it is semantically required by the proposal.',
  'Never invent item IDs, duplicate products, fuse items, redesign the product, recolor it, invent logos or place products on the body without compatible affordance.',
  'Decide human presence contextually as none, optional, recommended or required from product identity, category, affordance, valid use and campaign concept. Never apply a global always-use-a-model rule.',
  'Use recommended or required human presence primarily when contextual_lifestyle benefits from genuine demonstration of use, scale or advertising appeal. Keep the other campaign roles product-led unless independently justified, and never let people dominate all four proposals.',
  'Do not infer gender. Use gender-neutral human presentation unless product evidence or explicit user intent supplies sufficient context.',
  'Unknown-safe-context products require conservative, physically plausible commercial still-life or hero contexts.',
  'Use concrete locations, surfaces, materials, props, environmental colors, composition, camera, lens language, lighting and depth decisions. Avoid generic luxury filler.',
  'Do not provide commentary outside the structured result.',
].join(' ');

function canonicalRelationshipsSummary(normalizedInput) {
  const quantities = new Map(normalizedInput.productIdentity.items.map(({ id, quantity }) => [id, quantity]));
  const relationships = normalizedInput.productIdentity.relationships;
  if (relationships.length === 0) return 'CANONICAL RELATIONSHIPS:\n- none declared; do not invent relationships.';
  return [
    'CANONICAL RELATIONSHIPS — IMMUTABLE OPERATIONAL LOCKS:',
    ...relationships.map(({ type, itemIds }) => {
      const members = itemIds.map((id) => `${id} quantity=${quantities.get(id)}`).join(', ');
      const policy = /pair/i.test(type) ? 'pairPolicy=preserve_pair whenever the canonical pair is required' : 'preserve this exact relationship whenever its members are selected';
      return `- type=${type}; canonicalMembers=[${members}]; ${policy}.`;
    }),
    'Copy relationship types and canonical item IDs exactly. Do not substitute descriptive IDs, rename relationships, invent new relationships or use explicit_single_instance unless explicitly authorized by the input contract.',
  'For every proposal, requiredVisibleItems, optionalVisibleItems and pairPolicy must agree with these locks.',
  ].join('\n');
}

function visibilityInstructions(normalizedInput) {
  return [
    'PROPOSAL VISIBILITY RULES:',
    'VISIBILITY INTENT IS A CREATIVE DECISION FOR EACH PROPOSAL. Do not treat full inventory or full_set as the automatic default.',
    'For every proposal, actively decide whether its strongest advertising image requires the full canonical inventory, a canonical subset, or one safely representable canonical item.',
    'Base that decision on the campaign idea, commercial objective, composition, photography and product storytelling. Never reduce visibility merely to manufacture arbitrary variation.',
    'The global Product Identity remains unchanged even when a canonical item is omitted from one proposal.',
    'Each proposal may select a canonical subset when creatively appropriate. Mention only exact canonical IDs and never exceed their canonical quantities.',
    'Atomic relationships such as pair must be selected completely at canonical quantities with pairPolicy=preserve_pair, or omitted completely with pairPolicy=not_selected.',
    'Non-atomic relationships such as set do not require every member in every proposal; omitting a member changes only proposal visibility, never the global relationship.',
    'requiredVisibleItems, optionalVisibleItems, heroItemIds, supportingItemIds and visibilityIntent must describe one coherent selection.',
    'Consider meaningful diversity of product presentation across the four campaigns, but do not mechanically force four visibility patterns. Full inventory in all four is valid only when independently justified as creatively necessary for every campaign.',
    'CONTEXTUAL_LIFESTYLE is not automatically a still life. When affordance supports genuine human use or interaction, actively evaluate whether correct real use creates a stronger advertising image: a wearable may be worn only at valid placement, a handheld product may be held naturally, and a consumable may appear in plausible consumption. These are reasoning examples, not category templates. Still life remains valid when it is genuinely the stronger contextual solution.',
    'If contextual human use is selected, preserve canonical identity, quantities and protected relationships, and maintain valid placement, realistic scale and physical plausibility.',
    'EDITORIAL_CRAFT_DETAIL prioritizes distinctive craftsmanship, geometry, materials, texture and construction. Choose full inventory, a canonical subset or one safely representable item according to the strongest detail photograph; do not crowd a macro composition with every global item, and never break an atomic relationship for a close-up.',
    'CONCEPT_CAMPAIGN may choose full inventory or a canonical subset to maximize iconic composition, visual metaphor, memorability and product recognition. Its freedom applies to the scene, never canonical product identity.',
    'HERO_COMMERCIAL optimizes immediate desirability and commercial readability. Full inventory can be appropriate when presenting a set, but is not mandatory unless an atomic canonical relationship requires it.',
    'ANTI-TEMPLATE RULE: do not assign visibility using a fixed campaignRole-to-visibility mapping. Reason independently about each proposal so the outputs feel art-directed rather than mechanically assigned.',
    'Selective visibility is not sufficient diversity: campaigns must still differ in idea, environment, presentation, photography, lighting, visual language and color strategy.',
    `AVAILABLE CANONICAL ITEM IDS: ${normalizedInput.productIdentity.items.map(({ id, quantity }) => `${id} quantity=${quantity}`).join('; ')}`,
  ].join('\n');
}

function safeUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined;
  const result = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens']) {
    if (Number.isSafeInteger(usage[key]) && usage[key] >= 0) result[key] = usage[key];
  }
  for (const [group, allowed] of [['input_tokens_details', ['cached_tokens']], ['output_tokens_details', ['reasoning_tokens']]]) {
    if (!usage[group] || typeof usage[group] !== 'object') continue;
    const details = {};
    for (const key of allowed) if (Number.isSafeInteger(usage[group][key]) && usage[group][key] >= 0) details[key] = usage[group][key];
    if (Object.keys(details).length) result[group] = details;
  }
  return Object.keys(result).length ? result : undefined;
}

function responseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text;
  for (const item of payload?.output ?? []) {
    for (const content of item?.content ?? []) if (content?.type === 'output_text' && typeof content.text === 'string') return content.text;
  }
  return undefined;
}

function providerError(code, message, metadata = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, metadata);
  return error;
}

export function createOpenAICreativeDirectorV3Adapter({
  apiKey = process.env.OPENAI_API_KEY,
  fetchImpl = globalThis.fetch,
  timeoutMs = OPENAI_CREATIVE_DIRECTOR_V3_TIMEOUT_MS,
  sourceImage,
} = {}) {
  let metadata = Object.freeze({ provider: 'openai', model: OPENAI_CREATIVE_DIRECTOR_V3_MODEL, statusHttp: null });
  return Object.freeze({
    name: 'openai-creative-director-v3',
    configured: typeof apiKey === 'string' && apiKey.length > 0,
    lastMetadata: () => metadata,
    async generate(normalizedInput) {
      if (typeof apiKey !== 'string' || !apiKey) throw providerError('OPENAI_NOT_CONFIGURED', 'OpenAI Creative Director V3 is not configured.');
      if (typeof fetchImpl !== 'function') throw providerError('OPENAI_TRANSPORT_UNAVAILABLE', 'OpenAI transport is unavailable.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const startedAt = Date.now();
      try {
        const preparedSource = await prepareCreativeDirectorV3SourceImage(sourceImage);
        const content = [{ type: 'input_text', text: [
          canonicalRelationshipsSummary(normalizedInput),
          visibilityInstructions(normalizedInput),
          'NORMALIZED V3 INPUT:',
          JSON.stringify(normalizedInput),
        ].join('\n') }];
        if (preparedSource) content.push({
          type: 'input_image', detail: 'high',
          image_url: `data:${preparedSource.mimeType};base64,${preparedSource.bytes.toString('base64')}`,
        });
        const response = await fetchImpl(OPENAI_RESPONSES_ENDPOINT, {
          method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: OPENAI_CREATIVE_DIRECTOR_V3_MODEL,
            instructions: SYSTEM_INSTRUCTIONS,
            input: [{ role: 'user', content }],
            reasoning: { effort: 'low' }, max_output_tokens: 12_000, store: false,
            text: { format: { type: 'json_schema', name: 'creative_director_v3_briefs', strict: true, schema: OPENAI_CREATIVE_DIRECTOR_V3_SCHEMA } },
          }),
        });
        metadata = Object.freeze({ provider: 'openai', model: OPENAI_CREATIVE_DIRECTOR_V3_MODEL, statusHttp: response.status, latencyMs: Date.now() - startedAt });
        if (!response.ok) throw providerError('OPENAI_HTTP_ERROR', 'OpenAI Creative Director request failed.', { statusHttp: response.status });
        let payload;
        try { payload = await response.json(); } catch { throw providerError('OPENAI_MALFORMED_RESPONSE', 'OpenAI returned malformed JSON.', { statusHttp: response.status }); }
        const output = responseText(payload);
        if (!output) throw providerError('OPENAI_MALFORMED_RESPONSE', 'OpenAI returned no structured output.', { statusHttp: response.status });
        let parsed;
        try { parsed = JSON.parse(output); } catch { throw providerError('OPENAI_INVALID_STRUCTURED_OUTPUT', 'OpenAI structured output could not be parsed.', { statusHttp: response.status }); }
        metadata = Object.freeze({ ...metadata, usage: safeUsage(payload.usage) });
        return parsed?.briefs;
      } catch (error) {
        if (error?.name === 'AbortError') throw providerError('OPENAI_TIMEOUT', 'OpenAI Creative Director request timed out.');
        if (error?.code) throw error;
        throw providerError('OPENAI_NETWORK_ERROR', 'OpenAI Creative Director network request failed.');
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
