//! WebAssembly bindings used by the web app.
//!
//! - `Engine::analyze` looks a word up in vidyut-kosha, the finite-state transducer built by
//!   Ambuda from vidyut-prakriya's output, and returns every analysis it stores.
//! - `Engine::conjugate` / `Engine::decline` build paradigm tables with vidyut-prakriya.
//! - `Engine::derive_*` return full prakriyas, with the rule (sutra, varttika, ...) applied at
//!   each step.
//! - `transliterate` wraps vidyut-lipi.
//!
//! Values cross the JS boundary as JSON strings. Dhatus and pratipadikas are passed in the serde
//! form vidyut-prakriya defines, so JS can hand back exactly what `analyze` gave it.
use serde::Serialize;
use serde_json::{json, Value};
use std::str::FromStr;
use vidyut_kosha::entries::{PadaEntry, PratipadikaEntry};
use vidyut_kosha::Kosha;
use vidyut_lipi::{Lipika, Scheme};
use vidyut_prakriya::args::{
    Dhatu, Krdanta, Lakara, Linga, Pratipadika, Prayoga, Purusha, Subanta, Tinanta, Vacana,
    Vibhakti,
};
use vidyut_prakriya::{Prakriya, Rule, Vyakarana};
use wasm_bindgen::prelude::*;

#[derive(Serialize)]
struct WebStep {
    source: &'static str,
    code: &'static str,
    result: Vec<WebTerm>,
}

#[derive(Serialize)]
struct WebTerm {
    text: String,
    changed: bool,
}

#[derive(Serialize)]
struct WebPrakriya {
    text: String,
    steps: Vec<WebStep>,
}

fn rule_source(rule: &Rule) -> &'static str {
    match rule {
        Rule::Ashtadhyayi(_) => "ashtadhyayi",
        Rule::Varttika(_) => "varttika",
        Rule::Dhatupatha(_) => "dhatupatha",
        Rule::Unadipatha(_) => "unadipatha",
        Rule::Linganushasana(_) => "linganushasana",
        Rule::Phit(_) => "phit",
        Rule::Kashika(_) => "kashika",
        Rule::Kaumudi(_) => "kaumudi",
        Rule::Anyatra(_) => "anyatra",
    }
}

fn to_web(p: &Prakriya) -> WebPrakriya {
    WebPrakriya {
        text: p.text(),
        steps: p
            .history()
            .iter()
            .map(|s| WebStep {
                source: rule_source(&s.rule()),
                code: s.rule().code(),
                result: s
                    .result()
                    .iter()
                    .map(|t| WebTerm {
                        text: t.text().to_string(),
                        changed: t.was_changed(),
                    })
                    .collect(),
            })
            .collect(),
    }
}

fn texts(ps: &[Prakriya]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for p in ps {
        let t = p.text();
        if !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

fn parse<T: FromStr>(s: &str, what: &str) -> Result<T, JsError> {
    T::from_str(s).map_err(|_| JsError::new(&format!("unknown {what}: {s}")))
}

fn from_json<T: serde::de::DeserializeOwned>(s: &str, what: &str) -> Result<T, JsError> {
    serde_json::from_str(s).map_err(|e| JsError::new(&format!("bad {what}: {e}")))
}

fn dhatu_json(dhatu: &Dhatu) -> Value {
    let (aupadeshika, gana, antargana) = match dhatu {
        Dhatu::Mula(m) => (
            Some(m.aupadeshika().to_string()),
            Some(m.gana().as_str()),
            m.antargana().map(|a| a.as_str()),
        ),
        Dhatu::Nama(_) => (None, None, None),
    };
    json!({
        "spec": serde_json::to_value(dhatu).unwrap_or(Value::Null),
        "aupadeshika": aupadeshika,
        "gana": gana,
        "antargana": antargana,
        "prefixes": dhatu.prefixes(),
        "sanadi": dhatu.sanadi().iter().map(|s| s.as_str()).collect::<Vec<_>>(),
    })
}

#[wasm_bindgen]
pub struct Engine {
    v: Vyakarana,
    kosha: Option<Kosha>,
}

#[wasm_bindgen]
impl Engine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Engine {
        console_error_panic_hook::set_once();
        Engine {
            v: Vyakarana::builder().log_steps(true).build(),
            kosha: None,
        }
    }

    /// Loads the kosha from the contents of `padas.fst` and `registry.msgpack`.
    pub fn load_kosha(&mut self, fst: Vec<u8>, registry: Vec<u8>) -> Result<(), JsError> {
        let k = Kosha::from_bytes(fst, &registry).map_err(|e| JsError::new(&format!("{e:?}")))?;
        self.kosha = Some(k);
        Ok(())
    }

    pub fn has_kosha(&self) -> bool {
        self.kosha.is_some()
    }

    /// Returns every analysis of an SLP1 word as a JSON array.
    ///
    /// The kosha stores final visarga as `s` or `r`, so a final `H` is tried both ways.
    pub fn analyze(&self, word: &str) -> Result<String, JsError> {
        let kosha = self
            .kosha
            .as_ref()
            .ok_or_else(|| JsError::new("kosha not loaded"))?;
        let mut keys = vec![word.to_string()];
        if let Some(stem) = word.strip_suffix('H') {
            keys = vec![format!("{stem}s"), format!("{stem}r")];
        }
        let mut out = Vec::new();
        for key in &keys {
            for entry in kosha.get_all(key) {
                out.push(self.entry_json(key, &entry));
            }
        }
        Ok(Value::Array(out).to_string())
    }

    fn entry_json(&self, key: &str, entry: &PadaEntry) -> Value {
        match entry {
            PadaEntry::Tinanta(t) => {
                let d = t.dhatu_entry();
                json!({
                    "form": key,
                    "kind": "tinanta",
                    "lemma": t.dhatu_text(),
                    "dhatu": dhatu_json(t.dhatu()),
                    "artha_en": d.artha_en(),
                    "artha_sa": d.artha_sa(),
                    "prayoga": t.prayoga().as_str(),
                    "lakara": t.lakara().as_str(),
                    "purusha": t.purusha().as_str(),
                    "vacana": t.vacana().as_str(),
                })
            }
            PadaEntry::Subanta(s) => {
                let pe = s.pratipadika_entry();
                let pratipadika: Pratipadika = pe.into();
                let mut v = json!({
                    "form": key,
                    "kind": "subanta",
                    "avyaya": s.is_avyaya(),
                    "linga": s.linga().as_str(),
                    "vibhakti": s.vibhakti().as_str(),
                    "vacana": s.vacana().as_str(),
                    "lingas": pe.lingas().iter().map(|l| l.as_str()).collect::<Vec<_>>(),
                    "pratipadika": serde_json::to_value(&pratipadika).unwrap_or(Value::Null),
                });
                match pe {
                    PratipadikaEntry::Basic(b) => {
                        v["stem_kind"] = json!("basic");
                        v["lemma"] = json!(b.pratipadika().text());
                    }
                    PratipadikaEntry::Krdanta(k) => {
                        let krdanta: Krdanta = k.into();
                        let stems = texts(&self.v.derive_krdantas(&krdanta));
                        v["stem_kind"] = json!("krdanta");
                        v["lemma"] = json!(stems.first().cloned().unwrap_or_default());
                        v["stems"] = json!(stems);
                        v["root"] = json!(k.dhatu_text());
                        v["dhatu"] = dhatu_json(k.dhatu());
                        v["artha_en"] = json!(k.dhatu_entry().artha_en());
                        v["krt"] = json!(k.krt().as_str());
                        v["krt_prayoga"] = json!(k.prayoga().map(|p| p.as_str()));
                        v["krt_lakara"] = json!(k.lakara().map(|l| l.as_str()));
                    }
                }
                v
            }
        }
    }

    /// Finds kosha dhatus whose clean text is `text` (e.g. `gam`), without prefixes or sanadi.
    pub fn find_dhatus(&self, text: &str) -> Result<String, JsError> {
        let kosha = self
            .kosha
            .as_ref()
            .ok_or_else(|| JsError::new("kosha not loaded"))?;
        let out: Vec<Value> = kosha
            .dhatus()
            .filter(|d| {
                d.clean_text() == text
                    && d.dhatu().prefixes().is_empty()
                    && d.dhatu().sanadi().is_empty()
            })
            .map(|d| {
                let mut v = dhatu_json(d.dhatu());
                v["artha_en"] = json!(d.artha_en());
                v["artha_sa"] = json!(d.artha_sa());
                v["clean"] = json!(d.clean_text());
                v
            })
            .collect();
        Ok(Value::Array(out).to_string())
    }

    /// Finds basic kosha pratipadikas spelled `text`, with the lingas the kosha allows.
    pub fn find_pratipadikas(&self, text: &str) -> Result<String, JsError> {
        let kosha = self
            .kosha
            .as_ref()
            .ok_or_else(|| JsError::new("kosha not loaded"))?;
        let out: Vec<Value> = kosha
            .pratipadikas()
            .filter_map(|p| match &p {
                PratipadikaEntry::Basic(b) if b.pratipadika().text() == text => {
                    let pratipadika: Pratipadika = (&p).into();
                    Some(json!({
                        "lemma": text,
                        "avyaya": p.is_avyaya(),
                        "lingas": p.lingas().iter().map(|l| l.as_str()).collect::<Vec<_>>(),
                        "pratipadika": serde_json::to_value(&pratipadika).unwrap_or(Value::Null),
                    }))
                }
                _ => None,
            })
            .collect();
        Ok(Value::Array(out).to_string())
    }

    /// Conjugates a dhatu (vidyut-prakriya serde JSON) in one prayoga across all lakaras.
    ///
    /// Returns `{lakara: [[forms for purusha × vacana]]}`.
    pub fn conjugate(&self, dhatu: &str, prayoga: &str) -> Result<String, JsError> {
        let dhatu: Dhatu = from_json(dhatu, "dhatu")?;
        let prayoga: Prayoga = parse(prayoga, "prayoga")?;
        let mut out = serde_json::Map::new();
        for lakara in Lakara::iter() {
            if lakara == Lakara::Let {
                continue;
            }
            let mut rows = Vec::new();
            for purusha in Purusha::iter() {
                let mut row = Vec::new();
                for vacana in Vacana::iter() {
                    let args = Tinanta::new(dhatu.clone(), prayoga, lakara, purusha, vacana);
                    row.push(texts(&self.v.derive_tinantas(&args)));
                }
                rows.push(row);
            }
            out.insert(lakara.as_str().to_string(), json!(rows));
        }
        Ok(Value::Object(out).to_string())
    }

    /// Declines a pratipadika (vidyut-prakriya serde JSON) in one linga.
    ///
    /// Returns `[[forms for vacana] for each vibhakti]`.
    pub fn decline(&self, pratipadika: &str, linga: &str) -> Result<String, JsError> {
        let p: Pratipadika = from_json(pratipadika, "pratipadika")?;
        let linga: Linga = parse(linga, "linga")?;
        let mut rows = Vec::new();
        for vibhakti in Vibhakti::iter() {
            let mut row = Vec::new();
            for vacana in Vacana::iter() {
                let args = Subanta::new(p.clone(), linga, vibhakti, vacana);
                row.push(texts(&self.v.derive_subantas(&args)));
            }
            rows.push(row);
        }
        Ok(json!(rows).to_string())
    }

    /// Builds a basic pratipadika from SLP1 text, for stems the kosha has not seen.
    pub fn basic_pratipadika(&self, text: &str) -> Result<String, JsError> {
        let p = Pratipadika::basic(
            vidyut_prakriya::args::Slp1String::from(text)
                .map_err(|e| JsError::new(&format!("{e:?}")))?,
        );
        Ok(serde_json::to_string(&p).unwrap_or_default())
    }

    pub fn derive_tinanta(
        &self,
        dhatu: &str,
        prayoga: &str,
        lakara: &str,
        purusha: &str,
        vacana: &str,
    ) -> Result<String, JsError> {
        let args = Tinanta::new(
            from_json(dhatu, "dhatu")?,
            parse(prayoga, "prayoga")?,
            parse(lakara, "lakara")?,
            parse(purusha, "purusha")?,
            parse(vacana, "vacana")?,
        );
        let ps: Vec<WebPrakriya> = self.v.derive_tinantas(&args).iter().map(to_web).collect();
        Ok(serde_json::to_string(&ps).unwrap_or_default())
    }

    pub fn derive_subanta(
        &self,
        pratipadika: &str,
        linga: &str,
        vibhakti: &str,
        vacana: &str,
    ) -> Result<String, JsError> {
        let args = Subanta::new(
            from_json::<Pratipadika>(pratipadika, "pratipadika")?,
            parse(linga, "linga")?,
            parse(vibhakti, "vibhakti")?,
            parse(vacana, "vacana")?,
        );
        let ps: Vec<WebPrakriya> = self.v.derive_subantas(&args).iter().map(to_web).collect();
        Ok(serde_json::to_string(&ps).unwrap_or_default())
    }
}

impl Default for Engine {
    fn default() -> Self {
        Self::new()
    }
}

/// Transliterates `text` between two vidyut-lipi schemes, named as in `Scheme` (e.g. `Slp1`,
/// `Devanagari`, `Iast`, `HarvardKyoto`, `Itrans`).
#[wasm_bindgen(js_name = translit)]
pub fn translit(text: &str, from: &str, to: &str) -> Result<String, JsError> {
    let from: Scheme = parse(from, "scheme")?;
    let to: Scheme = parse(to, "scheme")?;
    // Lipika caches its scheme mappings, so keep one around instead of rebuilding per call.
    LIPIKA.with(|l| Ok(l.borrow_mut().transliterate(text, from, to)))
}

thread_local! {
    static LIPIKA: std::cell::RefCell<Lipika> = std::cell::RefCell::new(Lipika::new());
}

/// Detects the scheme of `text`, returning its `Scheme` name, or an empty string.
#[wasm_bindgen(js_name = detectScheme)]
pub fn detect_scheme(text: &str) -> String {
    match vidyut_lipi::detect(text) {
        Some(s) => format!("{s:?}"),
        None => String::new(),
    }
}
