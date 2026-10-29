# Build everything needed to serve site/ locally or on GitHub Pages.
#
#   make            fetch sources, build WebAssembly and data
#   make serve      serve site/ at http://127.0.0.1:8765

PY := python3 -I
VIDYUT_DATA := https://github.com/ambuda-org/vidyut/releases/download/py-0.4.0/data-0.4.0.zip
DCS_REPO := https://github.com/OliverHellwig/sanskrit.git

.PHONY: all fetch fetch-cdsl fetch-vidyut fetch-dcs wasm data dicts etym grammar kosha corpus serve clean

all: fetch wasm data

fetch: fetch-cdsl fetch-vidyut fetch-dcs

fetch-cdsl:
	$(PY) scripts/fetch_cdsl.py

fetch-vidyut: data-src/vidyut/kosha/padas.fst
data-src/vidyut/kosha/padas.fst:
	mkdir -p data-src/vidyut
	curl -sSL -o data-src/vidyut/data.zip $(VIDYUT_DATA)
	cd data-src/vidyut && unzip -q -o data.zip

fetch-dcs: data-src/dcs/dcs/data/conllu
data-src/dcs/dcs/data/conllu:
	git clone -q --depth 1 --filter=blob:none --sparse $(DCS_REPO) data-src/dcs
	git -C data-src/dcs sparse-checkout set dcs/data/conllu

# Applies the small patch that lets vidyut-kosha load from memory, then builds the bindings.
wasm:
	git submodule update --init vendor/vidyut
	git -C vendor/vidyut apply --check ../../wasm/patches/kosha-from-bytes.patch 2>/dev/null && \
	  git -C vendor/vidyut apply ../../wasm/patches/kosha-from-bytes.patch || true
	cd wasm && wasm-pack build --target web --release --out-dir ../site/pkg --no-pack
	rm -f site/pkg/.gitignore site/pkg/*.d.ts

data: dicts etym grammar kosha corpus

dicts:
	$(PY) scripts/build_dicts.py

etym: dicts
	$(PY) scripts/build_etym.py

grammar:
	$(PY) scripts/build_grammar.py

kosha: fetch-vidyut
	mkdir -p site/data/kosha
	gzip -9 -c data-src/vidyut/kosha/padas.fst > site/data/kosha/padas.fst.gz
	gzip -9 -c data-src/vidyut/kosha/registry.msgpack > site/data/kosha/registry.msgpack.gz

corpus:
	$(PY) scripts/build_corpus.py

serve:
	cd site && python3 -m http.server 8765 --bind 127.0.0.1

clean:
	rm -rf site/data site/pkg wasm/target
