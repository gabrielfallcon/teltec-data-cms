const axios = require("axios");
const OpenAI = require("openai");
require("dotenv").config();

const STRAPI_URL = process.env.STRAPI_URL + "/api";
const TOKEN = process.env.STRAPI_TOKEN;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
};

const CONTENT_TYPES = ["posts"];
const LOCALES = ["en", "es"];

// Delay para evitar rate limit
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function alreadyHasLocale(entry, locale) {
  if (!entry.localizations) return false;

  if (Array.isArray(entry.localizations)) {
    return entry.localizations.some((loc) => loc.locale === locale);
  }

  if (entry.localizations.data) {
    return entry.localizations.data.some(
      (loc) => loc.attributes.locale === locale,
    );
  }

  return false;
}

//Funcção para extrair os textos de um Rich Text
function extractTextsFromRichText(blocks) {
  const texts = [];

  function traverse(node) {
    if (Array.isArray(node)) {
      node.forEach(traverse);
    } else if (node && typeof node === "object") {
      if (node.text && node.text.trim().length > 0) {
        texts.push(node.text);
      }

      Object.values(node).forEach(traverse);
    }
  }

  traverse(blocks);
  return texts;
}

//Função para traduzir textos com AI
async function translateTexts(texts, locale) {
  const lang = locale === "en" ? "English" : "Spanish";

  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "system",
        content: `Translate all texts to ${lang}. Return as JSON array in same order.`,
      },
      {
        role: "user",
        content: JSON.stringify(texts),
      },
    ],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(res.choices[0].message.content);

  return parsed.texts || parsed;
}

//troca de textos
function replaceTextsInRichText(blocks, translatedTexts) {
  let index = 0;

  function traverse(node) {
    if (Array.isArray(node)) {
      node.forEach(traverse);
    } else if (node && typeof node === "object") {
      if (node.text && node.text.trim().length > 0) {
        node.text = translatedTexts[index++] || node.text;
      }

      Object.values(node).forEach(traverse);
    }
  }

  const clone = JSON.parse(JSON.stringify(blocks)); // evita mutação
  traverse(clone);

  return clone;
}

// Traduz tudo de uma vez (1 request por post)
async function translateFields(entry, locale, retries = 3) {
  try {
    const lang = locale === "en" ? "English" : "Spanish";

    const payload = {
      title: entry.title,
      summary: entry.summary,
      metaDescription: entry.metaDescription,
    };

    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Translate to ${lang}. Return ONLY valid JSON.`,
        },
        {
          role: "user",
          content: JSON.stringify(payload),
        },
      ],
      response_format: { type: "json_object" },
    });

    return JSON.parse(res.choices[0].message.content);
  } catch (err) {
    if (retries > 0) {
      console.log("Retrying...");
      await sleep(2000);
      return translateFields(entry, locale, retries - 1);
    }
    throw err;
  }
}

// Verifica se já existe tradução para aquele idioma
function alreadyHasLocale(entry, locale) {
  if (!entry.localizations || !entry.localizations.data) return false;

  return entry.localizations.data.some(
    (loc) => loc.attributes.locale === locale,
  );
}

function extractRelations(attributes) {
  const relations = {};

  console.log(attributes, "info");
  if (attributes.author?.data?.id) {
    relations.author = {
      connect: [attributes.author.id],
    };
  }

  return relations;
}

async function processContentType(type) {
  try {
    console.log(`\nProcessing ${type}`);

    const res = await axios.get(`${STRAPI_URL}/${type}?locale=pt&populate=*`, {
      headers: HEADERS,
    });

    const entries = res.data.data;

    console.log(entries, "log de inspec");

    for (const entry of entries) {
      const attributes = entry.attributes || entry;

      console.log(entry.id, "info id");

      if (!attributes) continue;

      if (!entry.documentId) {
        console.log("❌ Sem documentId, pulando:", entry.id);
        continue;
      }

      for (const locale of LOCALES) {
        // 🔥 PULA se já traduzido
        if (alreadyHasLocale(entry, locale)) {
          console.log(`⏭️ Já existe ${locale}, pulando...`);
          continue;
        }

        console.log(`🌍 Traduzindo para ${locale}...`);

        const translated = await translateFields(attributes, locale);
        const relations = extractRelations(attributes);
        // 🔹 traduz rich text separado
        let translatedContent = attributes.content;

        if (attributes.content && Array.isArray(attributes.content)) {
          const texts = extractTextsFromRichText(attributes.content);

          if (texts.length > 0) {
            const translatedTexts = await translateTexts(texts, locale);

            translatedContent = replaceTextsInRichText(
              attributes.content,
              translatedTexts,
            );
          }
        }

        const safeData = {
          title: translated.title,
          summary: translated.summary,
          metaDescription: translated.metaDescription,
          content: translatedContent,

          ...relations,
        };

        console.log(safeData, "inspecionando");

        if (!translated.title || !translatedContent) {
          console.log("❌ Tradução inválida, pulando...");
          continue;
        }

        await axios.put(
          `${STRAPI_URL}/${type}/${entry.documentId}?locale=${locale}`,
          {
            data: {
              ...safeData,
              // locale,
            },
          },
          { headers: HEADERS },
        );

        // evita rate limit
        await sleep(1000);
      }
    }
  } catch (err) {
    console.log(err.response.data, "erro");
  }
}

async function run() {
  for (const type of CONTENT_TYPES) {
    await processContentType(type);
  }

  console.log("\n🚀 Translation completed");
}

run();
