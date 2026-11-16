#include "synlexa/bio_core.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <iomanip>
#include <limits>
#include <sstream>
#include <unordered_map>
#include <unordered_set>

namespace synlexa::bio {

namespace {

constexpr std::array<std::uint32_t, 64> kShaK = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u, 0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u, 0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u, 0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
};

inline std::uint32_t rotr(std::uint32_t x, std::uint32_t n) {
    return (x >> n) | (x << (32u - n));
}

void sha256_compress(std::array<std::uint32_t, 8>& state, const std::uint8_t* block) {
    std::array<std::uint32_t, 64> w{};
    for (int i = 0; i < 16; ++i) {
        w[i] = (static_cast<std::uint32_t>(block[i * 4]) << 24) |
               (static_cast<std::uint32_t>(block[i * 4 + 1]) << 16) |
               (static_cast<std::uint32_t>(block[i * 4 + 2]) << 8) |
               static_cast<std::uint32_t>(block[i * 4 + 3]);
    }
    for (int i = 16; i < 64; ++i) {
        std::uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
        std::uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
        w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }

    auto [a, b, c, d, e, f, g, h] = state;
    for (int i = 0; i < 64; ++i) {
        std::uint32_t s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        std::uint32_t ch = (e & f) ^ ((~e) & g);
        std::uint32_t temp1 = h + s1 + ch + kShaK[i] + w[i];
        std::uint32_t s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        std::uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
        std::uint32_t temp2 = s0 + maj;

        h = g;
        g = f;
        f = e;
        e = d + temp1;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2;
    }
    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
    state[5] += f;
    state[6] += g;
    state[7] += h;
}

std::string to_lower_ascii(std::string s) {
    for (char& ch : s) {
        ch = static_cast<char>(std::tolower(static_cast<unsigned char>(ch)));
    }
    return s;
}

std::string to_upper_ascii(std::string s) {
    for (char& ch : s) {
        ch = static_cast<char>(std::toupper(static_cast<unsigned char>(ch)));
    }
    return s;
}

std::string trim_ascii(const std::string& s) {
    std::size_t a = 0;
    while (a < s.size() && std::isspace(static_cast<unsigned char>(s[a]))) ++a;
    std::size_t b = s.size();
    while (b > a && std::isspace(static_cast<unsigned char>(s[b - 1]))) --b;
    return s.substr(a, b - a);
}

bool is_water(const std::string& res_name) {
    std::string up = to_upper_ascii(trim_ascii(res_name));
    return up == "HOH" || up == "DOD" || up == "WAT" || up == "H2O";
}

bool is_better_alt_loc(char new_alt, double new_occ, char cur_alt, double cur_occ) {
    bool nb = (new_alt == ' ');
    bool cb = (cur_alt == ' ');
    if (nb != cb) return nb;
    if (std::abs(new_occ - cur_occ) > 1e-6) return new_occ > cur_occ;
    if (new_alt == 'A' && cur_alt != 'A') return true;
    if (cur_alt == 'A' && new_alt != 'A') return false;
    return new_alt < cur_alt;
}

void upsert_atom(std::vector<AtomRecord>& atoms, const AtomRecord& cand) {
    for (auto& ex : atoms) {
        if (ex.name == cand.name) {
            if (is_better_alt_loc(cand.alt_loc, cand.occupancy, ex.alt_loc, ex.occupancy)) {
                ex = cand;
            }
            return;
        }
    }
    atoms.push_back(cand);
}

struct ChainBuilder {
    std::string chain_id;
    std::string auth_chain_id;
    bool has_alt_locs{false};
    bool has_insertion_codes{false};
    std::vector<Residue> residues;
    std::unordered_map<std::string, std::size_t> res_index;

    void add_atom(int seq_id, std::optional<int> label_seq_id, const std::string& ins_code,
                  const std::string& res_name3, const AtomRecord& atom) {
        if (atom.alt_loc != ' ') has_alt_locs = true;
        if (!ins_code.empty()) has_insertion_codes = true;
        std::string key = std::to_string(seq_id) + "#" + ins_code;
        std::size_t idx = 0;
        auto it = res_index.find(key);
        if (it != res_index.end()) {
            idx = it->second;
        } else {
            idx = residues.size();
            res_index[key] = idx;
            Residue r;
            r.seq_id = seq_id;
            r.label_seq_id = label_seq_id;
            r.ins_code = ins_code;
            r.res_name3 = res_name3;
            r.res_code1 = res3_to_1(res_name3);
            residues.push_back(std::move(r));
        }

        Residue& res = residues[idx];
        if (atom.name == "CA") {
            if (!res.ca.has_value() ||
                is_better_alt_loc(atom.alt_loc, atom.occupancy, res.ca_alt_loc, res.ca_occupancy)) {
                res.ca = atom.xyz;
                res.ca_alt_loc = atom.alt_loc;
                res.ca_occupancy = atom.occupancy;
                res.b_or_plddt = atom.b_or_plddt;
            }
        }
        upsert_atom(res.atoms, atom);
    }
};

struct CifToken {
    std::string text;
    bool quoted{false};
};

std::vector<CifToken> tokenize_cif(const std::string& content) {
    std::vector<CifToken> tokens;
    tokens.reserve(4096);
    std::size_t n = content.size();
    std::size_t i = 0;
    while (i < n) {
        char c = content[i];
        if (c == ' ' || c == '\t' || c == '\r' || c == '\n') {
            ++i;
            continue;
        }
        if (c == '#') {
            while (i < n && content[i] != '\n') ++i;
            continue;
        }
        if (c == ';' && (i == 0 || content[i - 1] == '\n' || content[i - 1] == '\r')) {
            ++i;
            std::string acc;
            bool closed = false;
            while (i < n) {
                if (content[i] == ';' && (content[i - 1] == '\n' || content[i - 1] == '\r')) {
                    tokens.push_back({std::move(acc), true});
                    ++i;
                    closed = true;
                    break;
                }
                if (content[i] != '\r' && content[i] != '\n') {
                    acc.push_back(content[i]);
                }
                ++i;
            }
            if (!closed) {
                throw CoreError("ERR_MALFORMED_STRUCTURE", "Unterminated mmCIF semicolon text field");
            }
            continue;
        }
        if (c == '\'' || c == '"') {
            char quote = c;
            ++i;
            std::size_t start = i;
            bool closed = false;
            while (i < n) {
                if (content[i] == quote &&
                    (i + 1 == n || content[i + 1] == ' ' || content[i + 1] == '\t' ||
                     content[i + 1] == '\r' || content[i + 1] == '\n')) {
                    tokens.push_back({content.substr(start, i - start), true});
                    ++i;
                    closed = true;
                    break;
                }
                if (content[i] == '\n') break;
                ++i;
            }
            if (!closed) {
                throw CoreError("ERR_MALFORMED_STRUCTURE", "Unterminated mmCIF quoted string");
            }
            continue;
        }
        std::size_t start = i;
        while (i < n && content[i] != ' ' && content[i] != '\t' && content[i] != '\r' &&
               content[i] != '\n') {
            ++i;
        }
        tokens.push_back({content.substr(start, i - start), false});
    }
    return tokens;
}

bool is_cif_keyword(const std::string& w) {
    std::string lw = to_lower_ascii(w);
    return lw == "loop_" || lw.rfind("data_", 0) == 0 || lw.rfind("save_", 0) == 0 ||
           lw == "stop_" || lw == "global_";
}

std::string clean_cif_seq(const std::string& raw) {
    std::string out;
    for (char ch : raw) {
        if (std::isalpha(static_cast<unsigned char>(ch))) {
            out.push_back(static_cast<char>(std::toupper(static_cast<unsigned char>(ch))));
        }
    }
    return out;
}

std::optional<double> parse_double_opt(const std::string& s) {
    if (s.empty() || s == "." || s == "?") return std::nullopt;
    try {
        std::size_t pos = 0;
        double v = std::stod(s, &pos);
        if (!std::isfinite(v)) return std::nullopt;
        for (std::size_t k = pos; k < s.size(); ++k) {
            if (!std::isspace(static_cast<unsigned char>(s[k]))) return std::nullopt;
        }
        return v;
    } catch (...) {
        return std::nullopt;
    }
}

std::optional<int> parse_int_opt(const std::string& s) {
    if (s.empty() || s == "." || s == "?") return std::nullopt;
    try {
        std::size_t pos = 0;
        int v = std::stoi(s, &pos);
        for (std::size_t k = pos; k < s.size(); ++k) {
            if (!std::isspace(static_cast<unsigned char>(s[k]))) return std::nullopt;
        }
        return v;
    } catch (...) {
        return std::nullopt;
    }
}

StructureFormat detect_format(const std::string& content) {
    std::istringstream iss(content);
    std::string line;
    int checked = 0;
    bool saw_pdb = false;
    while (checked < 200 && std::getline(iss, line)) {
        ++checked;
        std::string t = trim_ascii(line);
        if (t.empty() || t[0] == '#') continue;
        if (t.rfind("data_", 0) == 0 || t.rfind("loop_", 0) == 0 || t.rfind("_atom_site.", 0) == 0) {
            return StructureFormat::Mmcif;
        }
        if (line.rfind("HEADER", 0) == 0 || line.rfind("TITLE", 0) == 0 ||
            line.rfind("COMPND", 0) == 0 || line.rfind("SEQRES", 0) == 0 ||
            line.rfind("MODEL ", 0) == 0 || line.rfind("ATOM  ", 0) == 0 ||
            line.rfind("HETATM", 0) == 0) {
            saw_pdb = true;
        }
    }
    if (saw_pdb) return StructureFormat::Pdb;
    if (content.find("_atom_site.") != std::string::npos) return StructureFormat::Mmcif;
    if (content.find("\nATOM  ") != std::string::npos || content.rfind("ATOM  ", 0) == 0) {
        return StructureFormat::Pdb;
    }
    throw CoreError("ERR_MALFORMED_STRUCTURE", "Unrecognized structure format (expected mmCIF or PDB)");
}

ParsedStructure parse_mmcif(const std::string& content, const std::string& sha, SourceTypeHint hint) {
    auto tokens = tokenize_cif(content);
    std::size_t n = tokens.size();
    std::size_t i = 0;

    bool is_af = false;
    std::unordered_map<std::string, std::string> entity_seq;
    std::unordered_map<std::string, std::vector<std::string>> entity_strands;
    std::unordered_map<std::string, std::vector<std::pair<int, std::string>>> entity_seq_rows;

    std::vector<std::string> chain_order;
    std::unordered_map<std::string, ChainBuilder> chains_map;
    std::unordered_map<std::string, std::string> chain_entity;

    std::vector<std::string> ligand_order;
    std::unordered_map<std::string, Ligand> ligands_map;

    std::size_t atom_count = 0;
    std::optional<int> first_model;
    bool any_nonzero_b = false;

    while (i < n) {
        const auto& tok = tokens[i];
        std::string lower = to_lower_ascii(tok.text);

        if (!tok.quoted && (lower.rfind("data_af-", 0) == 0 || lower.rfind("data_mgyp", 0) == 0)) {
            is_af = true;
            ++i;
            continue;
        }

        if (!tok.quoted && lower == "loop_") {
            ++i;
            std::vector<std::string> cols;
            while (i < n && !tokens[i].quoted && tokens[i].text.rfind('_', 0) == 0) {
                cols.push_back(tokens[i].text);
                ++i;
            }
            if (cols.empty()) continue;

            std::size_t ncols = cols.size();
            auto dot = cols[0].find('.');
            std::string category = to_lower_ascii(dot == std::string::npos ? cols[0] : cols[0].substr(0, dot));

            // Pre-compute column indices for _atom_site fast path
            int c_group = -1, c_sym = -1, c_latom = -1, c_aatom = -1, c_alt = -1, c_lcomp = -1,
                c_acomp = -1, c_lasym = -1, c_aasym = -1, c_ent = -1, c_lseq = -1, c_aseq = -1,
                c_ins = -1, c_x = -1, c_y = -1, c_z = -1, c_occ = -1, c_b = -1, c_mod = -1;
            if (category == "_atom_site") {
                for (std::size_t ci = 0; ci < ncols; ++ci) {
                    const std::string& cn = cols[ci];
                    if (cn == "_atom_site.group_PDB") c_group = static_cast<int>(ci);
                    else if (cn == "_atom_site.type_symbol") c_sym = static_cast<int>(ci);
                    else if (cn == "_atom_site.label_atom_id") c_latom = static_cast<int>(ci);
                    else if (cn == "_atom_site.auth_atom_id") c_aatom = static_cast<int>(ci);
                    else if (cn == "_atom_site.label_alt_id") c_alt = static_cast<int>(ci);
                    else if (cn == "_atom_site.label_comp_id") c_lcomp = static_cast<int>(ci);
                    else if (cn == "_atom_site.auth_comp_id") c_acomp = static_cast<int>(ci);
                    else if (cn == "_atom_site.label_asym_id") c_lasym = static_cast<int>(ci);
                    else if (cn == "_atom_site.auth_asym_id") c_aasym = static_cast<int>(ci);
                    else if (cn == "_atom_site.label_entity_id") c_ent = static_cast<int>(ci);
                    else if (cn == "_atom_site.label_seq_id") c_lseq = static_cast<int>(ci);
                    else if (cn == "_atom_site.auth_seq_id") c_aseq = static_cast<int>(ci);
                    else if (cn == "_atom_site.pdbx_PDB_ins_code") c_ins = static_cast<int>(ci);
                    else if (cn == "_atom_site.Cartn_x") c_x = static_cast<int>(ci);
                    else if (cn == "_atom_site.Cartn_y") c_y = static_cast<int>(ci);
                    else if (cn == "_atom_site.Cartn_z") c_z = static_cast<int>(ci);
                    else if (cn == "_atom_site.occupancy") c_occ = static_cast<int>(ci);
                    else if (cn == "_atom_site.B_iso_or_equiv") c_b = static_cast<int>(ci);
                    else if (cn == "_atom_site.pdbx_PDB_model_num") c_mod = static_cast<int>(ci);
                }
            }

            std::vector<std::string> row;
            row.reserve(ncols);
            while (i < n) {
                const auto& wt = tokens[i];
                if (!wt.quoted && ((wt.text.rfind('_', 0) == 0 && wt.text.find('.') != std::string::npos) ||
                                   is_cif_keyword(wt.text))) {
                    break;
                }
                row.push_back(wt.text);
                ++i;
                if (row.size() == ncols) {
                    if (category == "_entity_poly") {
                        std::string eid, seq_can, seq_raw, strands;
                        for (std::size_t ci = 0; ci < ncols; ++ci) {
                            if (cols[ci] == "_entity_poly.entity_id") eid = row[ci];
                            else if (cols[ci] == "_entity_poly.pdbx_seq_one_letter_code_can") seq_can = clean_cif_seq(row[ci]);
                            else if (cols[ci] == "_entity_poly.pdbx_seq_one_letter_code") seq_raw = clean_cif_seq(row[ci]);
                            else if (cols[ci] == "_entity_poly.pdbx_strand_id") strands = row[ci];
                        }
                        std::string seq = !seq_can.empty() ? seq_can : seq_raw;
                        if (!eid.empty() && !seq.empty()) entity_seq[eid] = seq;
                        if (!eid.empty() && !strands.empty() && strands != "?" && strands != ".") {
                            std::stringstream ss(strands);
                            std::string item;
                            while (std::getline(ss, item, ',')) {
                                item = trim_ascii(item);
                                if (!item.empty()) entity_strands[eid].push_back(item);
                            }
                        }
                    } else if (category == "_entity_poly_seq") {
                        std::string eid, mon;
                        int num = 0;
                        for (std::size_t ci = 0; ci < ncols; ++ci) {
                            if (cols[ci] == "_entity_poly_seq.entity_id") eid = row[ci];
                            else if (cols[ci] == "_entity_poly_seq.num") num = parse_int_opt(row[ci]).value_or(0);
                            else if (cols[ci] == "_entity_poly_seq.mon_id") mon = row[ci];
                        }
                        if (!eid.empty() && !mon.empty()) {
                            entity_seq_rows[eid].push_back({num, mon});
                        }
                    } else if (category == "_ma_qa_metric" || category == "_ma_qa_metric_local") {
                        for (const auto& v : row) {
                            if (to_lower_ascii(v) == "plddt") is_af = true;
                        }
                    } else if (category == "_atom_site") {
                        ++atom_count;
                        if (atom_count > kMaxAtoms) {
                            throw CoreError("ERR_OVERSIZED_INPUT", "Atom count exceeds 250,000 limit");
                        }
                        int mod_num = c_mod >= 0 ? parse_int_opt(row[c_mod]).value_or(1) : 1;
                        if (!first_model.has_value()) first_model = mod_num;
                        if (*first_model == mod_num) {
                            auto xo = c_x >= 0 ? parse_double_opt(row[c_x]) : std::nullopt;
                            auto yo = c_y >= 0 ? parse_double_opt(row[c_y]) : std::nullopt;
                            auto zo = c_z >= 0 ? parse_double_opt(row[c_z]) : std::nullopt;
                            if (!xo || !yo || !zo) {
                                throw CoreError("ERR_MALFORMED_STRUCTURE", "Invalid Cartn_x/y/z coordinate in mmCIF");
                            }
                            double occ = (c_occ >= 0 ? parse_double_opt(row[c_occ]) : std::nullopt).value_or(1.0);
                            double bval = (c_b >= 0 ? parse_double_opt(row[c_b]) : std::nullopt).value_or(0.0);
                            if (std::abs(bval) > 1e-9) any_nonzero_b = true;

                            auto pick = [&](int a, int b) -> std::string {
                                if (a >= 0 && !row[a].empty() && row[a] != "?" && row[a] != ".") return row[a];
                                if (b >= 0 && !row[b].empty() && row[b] != "?" && row[b] != ".") return row[b];
                                return "";
                            };
                            std::string atom_name = pick(c_latom, c_aatom);
                            std::string comp_id = pick(c_lcomp, c_acomp);
                            std::string chain_id = pick(c_lasym, c_aasym);
                            if (chain_id.empty()) chain_id = "A";
                            std::string auth_chain = (c_aasym >= 0 && !row[c_aasym].empty() && row[c_aasym] != "?" && row[c_aasym] != ".")
                                                         ? row[c_aasym]
                                                         : chain_id;
                            char alt_loc = ' ';
                            if (c_alt >= 0 && !row[c_alt].empty() && row[c_alt] != "." && row[c_alt] != "?") {
                                alt_loc = row[c_alt][0];
                            }
                            std::string ins;
                            if (c_ins >= 0 && !row[c_ins].empty() && row[c_ins] != "." && row[c_ins] != "?") {
                                ins = row[c_ins];
                            }
                            std::string elem = (c_sym >= 0 && !row[c_sym].empty() && row[c_sym] != "?" && row[c_sym] != ".")
                                                   ? row[c_sym]
                                                   : (atom_name.empty() ? "C" : std::string(1, static_cast<char>(std::toupper(static_cast<unsigned char>(atom_name[0])))));
                            auto lseq = c_lseq >= 0 ? parse_int_opt(row[c_lseq]) : std::nullopt;
                            auto aseq = c_aseq >= 0 ? parse_int_opt(row[c_aseq]) : std::nullopt;
                            int seq_id = aseq.has_value() ? *aseq : lseq.value_or(0);

                            AtomRecord ar{atom_name, elem, {*xo, *yo, *zo}, occ, bval, alt_loc};
                            std::string grp = c_group >= 0 ? row[c_group] : "ATOM";
                            if (grp == "HETATM") {
                                if (!is_water(comp_id)) {
                                    std::string lkey = chain_id + "#" + std::to_string(seq_id) + "#" + ins + "#" + comp_id;
                                    if (ligands_map.find(lkey) == ligands_map.end()) {
                                        ligand_order.push_back(lkey);
                                        ligands_map[lkey] = Ligand{comp_id, chain_id, seq_id, ins, {}};
                                    }
                                    upsert_atom(ligands_map[lkey].atoms, ar);
                                }
                            } else {
                                if (chains_map.find(chain_id) == chains_map.end()) {
                                    chain_order.push_back(chain_id);
                                    chains_map[chain_id] = ChainBuilder{chain_id, auth_chain, false, false, {}, {}};
                                }
                                if (c_ent >= 0 && !row[c_ent].empty() && row[c_ent] != "?" && row[c_ent] != ".") {
                                    if (chain_entity.find(chain_id) == chain_entity.end()) {
                                        chain_entity[chain_id] = row[c_ent];
                                    }
                                }
                                chains_map[chain_id].add_atom(seq_id, lseq, ins, comp_id, ar);
                            }
                        }
                    }
                    row.clear();
                }
            }
            if (!row.empty()) {
                throw CoreError("ERR_MALFORMED_STRUCTURE", "Incomplete mmCIF loop row in " + category);
            }
            continue;
        }

        if (!tok.quoted && tok.text.rfind('_', 0) == 0 && i + 1 < n) {
            std::string tag = to_lower_ascii(tok.text);
            const std::string& val = tokens[i + 1].text;
            if (tag == "_entry.id") {
                std::string up = to_upper_ascii(val);
                if (up.rfind("AF-", 0) == 0 || up.rfind("MGYP", 0) == 0) is_af = true;
            } else if (tag == "_struct.title") {
                std::string lw = to_lower_ascii(val);
                if (lw.find("alphafold") != std::string::npos || lw.find("colabfold") != std::string::npos ||
                    lw.find("esmfold") != std::string::npos) {
                    is_af = true;
                }
            } else if (tag == "_entity_poly.pdbx_seq_one_letter_code_can" ||
                       tag == "_entity_poly.pdbx_seq_one_letter_code") {
                std::string s = clean_cif_seq(val);
                if (!s.empty() && (tag == "_entity_poly.pdbx_seq_one_letter_code_can" ||
                                   entity_seq.find("1") == entity_seq.end())) {
                    entity_seq["1"] = s;
                }
            } else if (tag == "_entity_poly.pdbx_strand_id" && val != "?" && val != ".") {
                std::stringstream ss(val);
                std::string item;
                while (std::getline(ss, item, ',')) {
                    item = trim_ascii(item);
                    if (!item.empty()) entity_strands["1"].push_back(item);
                }
            }
            i += 2;
            continue;
        }
        ++i;
    }

    ParsedStructure out;
    out.sha256 = sha;
    out.format = StructureFormat::Mmcif;
    out.model_index = first_model.value_or(1);

    for (const auto& cid : chain_order) {
        auto& cb = chains_map[cid];
        Chain ch;
        ch.chain_id = cb.chain_id;
        ch.auth_chain_id = cb.auth_chain_id;
        ch.residues = std::move(cb.residues);
        ch.has_alt_locs = cb.has_alt_locs;
        ch.has_insertion_codes = cb.has_insertion_codes;

        std::string eid = chain_entity.count(cid) ? chain_entity[cid] : "1";
        if (entity_seq.count(eid)) {
            ch.declared_sequence = entity_seq[eid];
        } else {
            for (const auto& [e, strands] : entity_strands) {
                for (const auto& st : strands) {
                    if ((st == ch.auth_chain_id || st == ch.chain_id) && entity_seq.count(e)) {
                        ch.declared_sequence = entity_seq[e];
                        break;
                    }
                }
                if (ch.declared_sequence.has_value()) break;
            }
        }
        if (!ch.declared_sequence.has_value() && entity_seq_rows.count(eid)) {
            auto rows = entity_seq_rows[eid];
            std::sort(rows.begin(), rows.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
            std::string seq;
            for (const auto& r : rows) seq.push_back(res3_to_1(r.second));
            if (!seq.empty()) ch.declared_sequence = seq;
        }
        if (ch.observed_ca_count() > 0) out.chains.push_back(std::move(ch));
    }

    if (out.chains.empty()) {
        throw CoreError("ERR_NO_COORDINATES", "No polymer C-alpha coordinates found in mmCIF");
    }
    for (const auto& lk : ligand_order) {
        out.ligands.push_back(std::move(ligands_map[lk]));
    }

    if (hint == SourceTypeHint::Prediction) out.confidence_kind = ConfidenceKind::PredictionPlddt;
    else if (hint == SourceTypeHint::Experimental) out.confidence_kind = any_nonzero_b ? ConfidenceKind::ExperimentalBFactor : ConfidenceKind::None;
    else if (is_af) out.confidence_kind = ConfidenceKind::PredictionPlddt;
    else if (any_nonzero_b) out.confidence_kind = ConfidenceKind::ExperimentalBFactor;
    else out.confidence_kind = ConfidenceKind::None;

    return out;
}

std::string slice_col(const std::string& line, std::size_t a, std::size_t b) {
    if (a >= line.size()) return "";
    return line.substr(a, std::min(b, line.size()) - a);
}

ParsedStructure parse_pdb(const std::string& content, const std::string& sha, SourceTypeHint hint) {
    bool is_af = false;
    std::unordered_map<std::string, std::string> seqres;
    std::vector<std::string> chain_order;
    std::unordered_map<std::string, ChainBuilder> chains_map;
    std::vector<std::string> ligand_order;
    std::unordered_map<std::string, Ligand> ligands_map;

    std::size_t atom_count = 0;
    std::optional<int> first_model;
    int cur_model = 1;
    bool ignored_model = false;
    bool any_nonzero_b = false;

    std::istringstream iss(content);
    std::string line;
    while (std::getline(iss, line)) {
        if (!line.empty() && line.back() == '\r') line.pop_back();
        if (line.rfind("TITLE", 0) == 0 || line.rfind("HEADER", 0) == 0 ||
            line.rfind("REMARK", 0) == 0 || line.rfind("COMPND", 0) == 0) {
            std::string lw = to_lower_ascii(line);
            if (lw.find("alphafold") != std::string::npos || lw.find("plddt") != std::string::npos ||
                lw.find("colabfold") != std::string::npos || lw.find("esmfold") != std::string::npos) {
                is_af = true;
            }
            continue;
        }
        if (line.rfind("SEQRES", 0) == 0) {
            std::string ch = trim_ascii(slice_col(line, 11, 12));
            if (ch.empty()) ch = "A";
            std::istringstream rs(slice_col(line, 19, 70));
            std::string tok;
            while (rs >> tok) seqres[ch].push_back(res3_to_1(tok));
            continue;
        }
        if (line.rfind("MODEL ", 0) == 0) {
            cur_model = parse_int_opt(trim_ascii(slice_col(line, 10, 14))).value_or(1);
            if (!first_model.has_value()) {
                first_model = cur_model;
                ignored_model = false;
            } else {
                ignored_model = (*first_model != cur_model);
            }
            continue;
        }
        if (line.rfind("ENDMDL", 0) == 0) {
            ignored_model = first_model.has_value();
            continue;
        }

        bool is_atom = line.rfind("ATOM  ", 0) == 0;
        bool is_het = line.rfind("HETATM", 0) == 0;
        if (!is_atom && !is_het) continue;

        ++atom_count;
        if (atom_count > kMaxAtoms) {
            throw CoreError("ERR_OVERSIZED_INPUT", "Atom count exceeds 250,000 limit");
        }
        if (ignored_model) continue;
        if (!first_model.has_value()) first_model = cur_model;

        if (line.size() < 54) {
            throw CoreError("ERR_MALFORMED_STRUCTURE", "Truncated PDB ATOM/HETATM line");
        }

        std::string atom_name = trim_ascii(slice_col(line, 12, 16));
        char alt_loc = (line.size() > 16) ? line[16] : ' ';
        std::string res_name3 = trim_ascii(slice_col(line, 17, 20));
        std::string chain_id = trim_ascii(slice_col(line, 21, 22));
        if (chain_id.empty()) chain_id = "A";
        auto seq_opt = parse_int_opt(trim_ascii(slice_col(line, 22, 26)));
        if (!seq_opt) {
            throw CoreError("ERR_MALFORMED_STRUCTURE", "Invalid PDB residue sequence number");
        }
        std::string ins = trim_ascii(slice_col(line, 26, 27));
        auto xo = parse_double_opt(trim_ascii(slice_col(line, 30, 38)));
        auto yo = parse_double_opt(trim_ascii(slice_col(line, 38, 46)));
        auto zo = parse_double_opt(trim_ascii(slice_col(line, 46, 54)));
        if (!xo || !yo || !zo) {
            throw CoreError("ERR_MALFORMED_STRUCTURE", "Invalid PDB X/Y/Z coordinate");
        }
        double occ = parse_double_opt(trim_ascii(slice_col(line, 54, 60))).value_or(1.0);
        double bval = parse_double_opt(trim_ascii(slice_col(line, 60, 66))).value_or(0.0);
        if (std::abs(bval) > 1e-9) any_nonzero_b = true;
        std::string elem = trim_ascii(slice_col(line, 76, 78));
        if (elem.empty()) {
            for (char ch : atom_name) {
                if (std::isalpha(static_cast<unsigned char>(ch))) {
                    elem = std::string(1, static_cast<char>(std::toupper(static_cast<unsigned char>(ch))));
                    break;
                }
            }
            if (elem.empty()) elem = "C";
        }

        AtomRecord ar{atom_name, elem, {*xo, *yo, *zo}, occ, bval, alt_loc};
        if (is_het) {
            if (!is_water(res_name3)) {
                std::string lkey = chain_id + "#" + std::to_string(*seq_opt) + "#" + ins + "#" + res_name3;
                if (ligands_map.find(lkey) == ligands_map.end()) {
                    ligand_order.push_back(lkey);
                    ligands_map[lkey] = Ligand{res_name3, chain_id, *seq_opt, ins, {}};
                }
                upsert_atom(ligands_map[lkey].atoms, ar);
            }
            continue;
        }
        if (chains_map.find(chain_id) == chains_map.end()) {
            chain_order.push_back(chain_id);
            chains_map[chain_id] = ChainBuilder{chain_id, chain_id, false, false, {}, {}};
        }
        chains_map[chain_id].add_atom(*seq_opt, std::nullopt, ins, res_name3, ar);
    }

    ParsedStructure out;
    out.sha256 = sha;
    out.format = StructureFormat::Pdb;
    out.model_index = first_model.value_or(1);
    for (const auto& cid : chain_order) {
        auto& cb = chains_map[cid];
        Chain ch;
        ch.chain_id = cb.chain_id;
        ch.auth_chain_id = cb.auth_chain_id;
        ch.residues = std::move(cb.residues);
        ch.has_alt_locs = cb.has_alt_locs;
        ch.has_insertion_codes = cb.has_insertion_codes;
        if (seqres.count(cid)) ch.declared_sequence = seqres[cid];
        if (ch.observed_ca_count() > 0) out.chains.push_back(std::move(ch));
    }
    if (out.chains.empty()) {
        throw CoreError("ERR_NO_COORDINATES", "No polymer C-alpha coordinates found in PDB");
    }
    for (const auto& lk : ligand_order) {
        out.ligands.push_back(std::move(ligands_map[lk]));
    }
    if (hint == SourceTypeHint::Prediction) out.confidence_kind = ConfidenceKind::PredictionPlddt;
    else if (hint == SourceTypeHint::Experimental) out.confidence_kind = any_nonzero_b ? ConfidenceKind::ExperimentalBFactor : ConfidenceKind::None;
    else if (is_af) out.confidence_kind = ConfidenceKind::PredictionPlddt;
    else if (any_nonzero_b) out.confidence_kind = ConfidenceKind::ExperimentalBFactor;
    else out.confidence_kind = ConfidenceKind::None;

    return out;
}

std::string json_escape(const std::string& s) {
    std::string out = "\"";
    for (char ch : s) {
        switch (ch) {
        case '"': out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\r': out += "\\r"; break;
        case '\t': out += "\\t"; break;
        default: out.push_back(ch); break;
        }
    }
    out.push_back('"');
    return out;
}

std::string fmt_num(double v) {
    if (!std::isfinite(v)) return "null";
    if (v == 0.0) return "0";
    std::ostringstream oss;
    oss << std::setprecision(12) << v;
    return oss.str();
}

} // namespace

std::size_t Chain::observed_ca_count() const {
    std::size_t cnt = 0;
    for (const auto& r : residues) {
        if (r.ca.has_value()) ++cnt;
    }
    return cnt;
}

std::size_t Chain::model_residue_count() const {
    return declared_sequence.has_value() ? declared_sequence->size() : observed_ca_count();
}

std::string Chain::denominator_kind() const {
    return declared_sequence.has_value() ? "declared_polymer_sequence" : "coordinate_only";
}

std::string sha256_hex(const std::string& data) {
    std::array<std::uint32_t, 8> state = {
        0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
        0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u,
    };
    const auto* bytes = reinterpret_cast<const std::uint8_t*>(data.data());
    std::size_t len = data.size();
    std::size_t full = (len / 64) * 64;
    for (std::size_t i = 0; i < full; i += 64) {
        sha256_compress(state, bytes + i);
    }
    std::array<std::uint8_t, 128> tail{};
    std::size_t rem = len - full;
    for (std::size_t i = 0; i < rem; ++i) tail[i] = bytes[full + i];
    tail[rem] = 0x80;
    std::size_t blocks = (rem + 1 + 8 <= 64) ? 1 : 2;
    std::size_t len_off = blocks * 64 - 8;
    std::uint64_t bit_len = static_cast<std::uint64_t>(len) * 8ULL;
    for (int k = 0; k < 8; ++k) {
        tail[len_off + k] = static_cast<std::uint8_t>((bit_len >> (56 - 8 * k)) & 0xffu);
    }
    sha256_compress(state, tail.data());
    if (blocks == 2) sha256_compress(state, tail.data() + 64);

    static constexpr char kHex[] = "0123456789abcdef";
    std::string hex;
    hex.reserve(64);
    for (std::uint32_t w : state) {
        for (int s = 28; s >= 0; s -= 4) hex.push_back(kHex[(w >> s) & 0xfu]);
    }
    return hex;
}

char res3_to_1(const std::string& res3) {
    std::string up = to_upper_ascii(trim_ascii(res3));
    if (up == "ALA") return 'A';
    if (up == "ARG") return 'R';
    if (up == "ASN") return 'N';
    if (up == "ASP") return 'D';
    if (up == "CYS") return 'C';
    if (up == "GLN") return 'Q';
    if (up == "GLU") return 'E';
    if (up == "GLY") return 'G';
    if (up == "HIS") return 'H';
    if (up == "ILE") return 'I';
    if (up == "LEU") return 'L';
    if (up == "LYS") return 'K';
    if (up == "MET" || up == "MSE") return 'M';
    if (up == "PHE") return 'F';
    if (up == "PRO") return 'P';
    if (up == "SER") return 'S';
    if (up == "THR") return 'T';
    if (up == "TRP") return 'W';
    if (up == "TYR") return 'Y';
    if (up == "VAL") return 'V';
    if (up == "SEC") return 'U';
    if (up == "PYL") return 'O';
    return 'X';
}

ParsedStructure parse_structure(const std::string& content, SourceTypeHint hint) {
    if (content.size() > kMaxInputBytes) {
        throw CoreError("ERR_OVERSIZED_INPUT", "Structure input exceeds 50 MB limit");
    }
    if (trim_ascii(content).empty()) {
        throw CoreError("ERR_MALFORMED_STRUCTURE", "Structure input is empty");
    }
    std::string sha = sha256_hex(content);
    StructureFormat fmt = detect_format(content);
    if (fmt == StructureFormat::Mmcif) return parse_mmcif(content, sha, hint);
    return parse_pdb(content, sha, hint);
}

std::array<double, 3> transform_point(const std::array<double, 16>& m,
                                      const std::array<double, 3>& p) {
    return {
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
        m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
        m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
    };
}

std::pair<std::array<double, 16>, double> kabsch_superpose(
    const std::vector<std::array<double, 3>>& ref_pts,
    const std::vector<std::array<double, 3>>& mob_pts) {
    std::size_t n = ref_pts.size();
    if (n != mob_pts.size() || n < 3) {
        throw CoreError("ERR_NO_COORDINATES", "At least 3 matched C-alpha coordinates required");
    }

    double inv_n = 1.0 / static_cast<double>(n);
    std::array<double, 3> c_ref{0.0, 0.0, 0.0};
    std::array<double, 3> c_mob{0.0, 0.0, 0.0};
    for (std::size_t i = 0; i < n; ++i) {
        for (int k = 0; k < 3; ++k) {
            c_ref[k] += ref_pts[i][k];
            c_mob[k] += mob_pts[i][k];
        }
    }
    for (int k = 0; k < 3; ++k) {
        c_ref[k] *= inv_n;
        c_mob[k] *= inv_n;
    }

    double s[3][3]{};
    for (std::size_t i = 0; i < n; ++i) {
        double dp[3] = {mob_pts[i][0] - c_mob[0], mob_pts[i][1] - c_mob[1], mob_pts[i][2] - c_mob[2]};
        double dq[3] = {ref_pts[i][0] - c_ref[0], ref_pts[i][1] - c_ref[1], ref_pts[i][2] - c_ref[2]};
        for (int a = 0; a < 3; ++a) {
            for (int b = 0; b < 3; ++b) s[a][b] += dp[a] * dq[b];
        }
    }

    double a[4][4] = {
        {s[0][0] + s[1][1] + s[2][2], s[1][2] - s[2][1], s[2][0] - s[0][2], s[0][1] - s[1][0]},
        {s[1][2] - s[2][1], s[0][0] - s[1][1] - s[2][2], s[0][1] + s[1][0], s[0][2] + s[2][0]},
        {s[2][0] - s[0][2], s[0][1] + s[1][0], -s[0][0] + s[1][1] - s[2][2], s[1][2] + s[2][1]},
        {s[0][1] - s[1][0], s[0][2] + s[2][0], s[1][2] + s[2][1], -s[0][0] - s[1][1] + s[2][2]},
    };
    double v[4][4] = {{1, 0, 0, 0}, {0, 1, 0, 0}, {0, 0, 1, 0}, {0, 0, 0, 1}};

    for (int sweep = 0; sweep < 64; ++sweep) {
        double max_off = 0.0;
        for (int p = 0; p < 4; ++p)
            for (int q = p + 1; q < 4; ++q) max_off = std::max(max_off, std::abs(a[p][q]));
        if (max_off < 1e-15) break;

        for (int p = 0; p < 4; ++p) {
            for (int q = p + 1; q < 4; ++q) {
                double apq = a[p][q];
                if (std::abs(apq) < 1e-16) continue;
                double tau = (a[q][q] - a[p][p]) / (2.0 * apq);
                double t = (tau >= 0.0) ? 1.0 / (tau + std::sqrt(1.0 + tau * tau))
                                        : -1.0 / (-tau + std::sqrt(1.0 + tau * tau));
                double c = 1.0 / std::sqrt(1.0 + t * t);
                double sn = t * c;
                double app = a[p][p];
                double aqq = a[q][q];
                a[p][p] = app - t * apq;
                a[q][q] = aqq + t * apq;
                a[p][q] = 0.0;
                a[q][p] = 0.0;
                for (int r = 0; r < 4; ++r) {
                    if (r != p && r != q) {
                        double arp = a[r][p];
                        double arq = a[r][q];
                        a[r][p] = c * arp - sn * arq;
                        a[p][r] = a[r][p];
                        a[r][q] = sn * arp + c * arq;
                        a[q][r] = a[r][q];
                    }
                    double vrp = v[r][p];
                    double vrq = v[r][q];
                    v[r][p] = c * vrp - sn * vrq;
                    v[r][q] = sn * vrp + c * vrq;
                }
            }
        }
    }

    int best = 0;
    for (int c = 1; c < 4; ++c) {
        if (a[c][c] > a[best][best]) best = c;
    }
    double qw = v[0][best], qx = v[1][best], qy = v[2][best], qz = v[3][best];
    double norm = std::sqrt(qw * qw + qx * qx + qy * qy + qz * qz);
    if (norm > 1e-15) {
        qw /= norm; qx /= norm; qy /= norm; qz /= norm;
    } else {
        qw = 1.0; qx = qy = qz = 0.0;
    }

    double r[3][3] = {
        {qw * qw + qx * qx - qy * qy - qz * qz, 2.0 * (qx * qy - qw * qz), 2.0 * (qx * qz + qw * qy)},
        {2.0 * (qx * qy + qw * qz), qw * qw - qx * qx + qy * qy - qz * qz, 2.0 * (qy * qz - qw * qx)},
        {2.0 * (qx * qz - qw * qy), 2.0 * (qy * qz + qw * qx), qw * qw - qx * qx - qy * qy + qz * qz},
    };
    double tx = c_ref[0] - (r[0][0] * c_mob[0] + r[0][1] * c_mob[1] + r[0][2] * c_mob[2]);
    double ty = c_ref[1] - (r[1][0] * c_mob[0] + r[1][1] * c_mob[1] + r[1][2] * c_mob[2]);
    double tz = c_ref[2] - (r[2][0] * c_mob[0] + r[2][1] * c_mob[1] + r[2][2] * c_mob[2]);

    std::array<double, 16> mat = {
        r[0][0], r[0][1], r[0][2], tx,
        r[1][0], r[1][1], r[1][2], ty,
        r[2][0], r[2][1], r[2][2], tz,
        0.0, 0.0, 0.0, 1.0,
    };

    double sq = 0.0;
    for (std::size_t i = 0; i < n; ++i) {
        auto pt = transform_point(mat, mob_pts[i]);
        double dx = pt[0] - ref_pts[i][0];
        double dy = pt[1] - ref_pts[i][1];
        double dz = pt[2] - ref_pts[i][2];
        sq += dx * dx + dy * dy + dz * dz;
    }
    return {mat, std::sqrt(sq * inv_n)};
}

PaeSummary validate_pae_json(const std::optional<std::string>& pae_json,
                             std::size_t expected_residues) {
    if (!pae_json.has_value() || trim_ascii(*pae_json).empty()) {
        return {"missing", 0, std::nullopt};
    }
    const std::string& raw = *pae_json;
    std::optional<double> max_pae;
    auto mp_pos = raw.find("\"max_predicted_aligned_error\"");
    if (mp_pos != std::string::npos) {
        auto colon = raw.find(':', mp_pos);
        if (colon != std::string::npos) {
            std::size_t p = colon + 1;
            while (p < raw.size() && std::isspace(static_cast<unsigned char>(raw[p]))) ++p;
            std::size_t end = p;
            while (end < raw.size() && (std::isdigit(static_cast<unsigned char>(raw[end])) ||
                                        raw[end] == '.' || raw[end] == '-' || raw[end] == 'e' ||
                                        raw[end] == 'E' || raw[end] == '+')) {
                ++end;
            }
            max_pae = parse_double_opt(raw.substr(p, end - p));
        }
    }

    auto key_pos = raw.find("\"predicted_aligned_error\"");
    if (key_pos == std::string::npos) return {"incompatible_shape", 0, max_pae};
    auto colon = raw.find(':', key_pos);
    if (colon == std::string::npos) return {"incompatible_shape", 0, max_pae};
    std::size_t pos = raw.find('[', colon);
    if (pos == std::string::npos) return {"incompatible_shape", 0, max_pae};

    ++pos;
    std::size_t row_count = 0;
    bool shape_ok = true;
    while (pos < raw.size()) {
        while (pos < raw.size() && (std::isspace(static_cast<unsigned char>(raw[pos])) || raw[pos] == ',')) ++pos;
        if (pos >= raw.size()) { shape_ok = false; break; }
        if (raw[pos] == ']') break;
        if (raw[pos] != '[') { shape_ok = false; break; }
        ++pos;
        std::size_t col_count = 0;
        while (pos < raw.size()) {
            while (pos < raw.size() && (std::isspace(static_cast<unsigned char>(raw[pos])) || raw[pos] == ',')) ++pos;
            if (pos >= raw.size()) { shape_ok = false; break; }
            if (raw[pos] == ']') { ++pos; break; }
            std::size_t start = pos;
            while (pos < raw.size() && raw[pos] != ',' && raw[pos] != ']' &&
                   !std::isspace(static_cast<unsigned char>(raw[pos]))) {
                ++pos;
            }
            if (!parse_double_opt(raw.substr(start, pos - start))) {
                shape_ok = false;
                break;
            }
            ++col_count;
        }
        if (!shape_ok || col_count != expected_residues) {
            shape_ok = false;
            break;
        }
        ++row_count;
    }

    if (!shape_ok || row_count == 0 || row_count != expected_residues) {
        return {"incompatible_shape", row_count, max_pae};
    }
    return {"valid", row_count, max_pae};
}

namespace {

std::size_t select_chain(const ParsedStructure& s, const std::optional<std::string>& req,
                         const std::string& role) {
    if (!req.has_value() || trim_ascii(*req).empty()) {
        if (s.chains.size() == 1) return 0;
        std::vector<std::string> names;
        for (const auto& c : s.chains) names.push_back(c.chain_id);
        throw CoreError("ERR_AMBIGUOUS_CHAIN",
                        role + " structure has multiple polymer chains; specify chain explicitly",
                        std::move(names));
    }
    std::string target = trim_ascii(*req);
    for (std::size_t i = 0; i < s.chains.size(); ++i) {
        if (s.chains[i].chain_id == target || s.chains[i].auth_chain_id == target) return i;
    }
    throw CoreError("ERR_INVALID_INPUT", "Requested " + role + " chain '" + target + "' not found");
}

std::vector<std::pair<std::size_t, std::size_t>> align_residues(
    const std::vector<const Residue*>& ref_obs, const std::vector<const Residue*>& mob_obs) {
    std::size_t n = ref_obs.size();
    std::size_t m = mob_obs.size();
    if (n == 0 || m == 0) return {};

    if (n == m) {
        bool ident = true;
        for (std::size_t i = 0; i < n; ++i) {
            if (ref_obs[i]->res_code1 != mob_obs[i]->res_code1 ||
                ref_obs[i]->seq_id != mob_obs[i]->seq_id) {
                ident = false;
                break;
            }
        }
        if (ident) {
            std::vector<std::pair<std::size_t, std::size_t>> pairs(n);
            for (std::size_t i = 0; i < n; ++i) pairs[i] = {i, i};
            return pairs;
        }
    }

    constexpr double kNegInf = -1e18;
    constexpr double kGapOpen = -6.0;
    constexpr double kGapExt = -1.0;
    std::size_t stride = m + 1;
    std::size_t sz = (n + 1) * stride;
    std::vector<double> m_dp(sz, kNegInf), ix_dp(sz, kNegInf), iy_dp(sz, kNegInf);
    std::vector<std::uint8_t> tb_m(sz, 0), tb_x(sz, 0), tb_y(sz, 0);

    m_dp[0] = 0.0;
    for (std::size_t i = 1; i <= n; ++i) {
        ix_dp[i * stride] = kGapOpen + static_cast<double>(i - 1) * kGapExt;
        tb_x[i * stride] = (i == 1) ? 0 : 1;
    }
    for (std::size_t j = 1; j <= m; ++j) {
        iy_dp[j] = kGapOpen + static_cast<double>(j - 1) * kGapExt;
        tb_y[j] = (j == 1) ? 0 : 1;
    }

    for (std::size_t i = 1; i <= n; ++i) {
        const Residue* r = ref_obs[i - 1];
        for (std::size_t j = 1; j <= m; ++j) {
            const Residue* mb = mob_obs[j - 1];
            std::size_t idx = i * stride + j;

            double sub = (r->res_code1 == mb->res_code1 && r->res_code1 != 'X') ? 4.0
                         : (r->res_code1 == mb->res_code1) ? 2.0 : -2.0;
            if (r->seq_id == mb->seq_id && r->ins_code == mb->ins_code) sub += 0.5;
            else if (r->label_seq_id.has_value() && r->label_seq_id == mb->label_seq_id) sub += 0.4;
            else if (r->label_seq_id == std::optional<int>(mb->seq_id) ||
                     mb->label_seq_id == std::optional<int>(r->seq_id)) sub += 0.3;

            std::size_t prev = (i - 1) * stride + (j - 1);
            double pm = m_dp[prev], px = ix_dp[prev], py = iy_dp[prev];
            if (pm >= px && pm >= py) { m_dp[idx] = pm + sub; tb_m[idx] = 0; }
            else if (px >= py) { m_dp[idx] = px + sub; tb_m[idx] = 1; }
            else { m_dp[idx] = py + sub; tb_m[idx] = 2; }

            std::size_t up = (i - 1) * stride + j;
            double ox = m_dp[up] + kGapOpen, ex = ix_dp[up] + kGapExt;
            if (ox >= ex) { ix_dp[idx] = ox; tb_x[idx] = 0; }
            else { ix_dp[idx] = ex; tb_x[idx] = 1; }

            std::size_t left = i * stride + (j - 1);
            double oy = m_dp[left] + kGapOpen, ey = iy_dp[left] + kGapExt;
            if (oy >= ey) { iy_dp[idx] = oy; tb_y[idx] = 0; }
            else { iy_dp[idx] = ey; tb_y[idx] = 1; }
        }
    }

    std::size_t last = n * stride + m;
    std::uint8_t state = (m_dp[last] >= ix_dp[last] && m_dp[last] >= iy_dp[last]) ? 0
                         : (ix_dp[last] >= iy_dp[last]) ? 1 : 2;
    std::vector<std::pair<std::size_t, std::size_t>> pairs;
    std::size_t i = n, j = m;
    while (i > 0 || j > 0) {
        std::size_t idx = i * stride + j;
        if (state == 0) {
            if (i == 0 || j == 0) break;
            pairs.emplace_back(i - 1, j - 1);
            state = tb_m[idx];
            --i; --j;
        } else if (state == 1) {
            if (i == 0) break;
            state = tb_x[idx];
            --i;
        } else {
            if (j == 0) break;
            state = tb_y[idx];
            --j;
        }
    }
    std::reverse(pairs.begin(), pairs.end());
    return pairs;
}

const char* conf_str(ConfidenceKind k) {
    switch (k) {
    case ConfidenceKind::ExperimentalBFactor: return "experimental_b_factor";
    case ConfidenceKind::PredictionPlddt: return "prediction_plddt";
    default: return "none";
    }
}

} // namespace

ComparisonResult compare_structures(
    const std::string& ref_label,
    const ParsedStructure& ref_structure,
    const std::optional<std::string>& ref_chain_req,
    const std::string& mob_label,
    const ParsedStructure& mob_structure,
    const std::optional<std::string>& mob_chain_req,
    const std::optional<std::string>& pae_json,
    const std::string& created_at_utc) {
    std::size_t ref_idx = select_chain(ref_structure, ref_chain_req, "reference");
    std::size_t mob_idx = select_chain(mob_structure, mob_chain_req, "mobile");

    const Chain& ref_chain = ref_structure.chains[ref_idx];
    const Chain& mob_chain = mob_structure.chains[mob_idx];

    std::vector<const Residue*> ref_obs, mob_obs;
    for (const auto& r : ref_chain.residues) if (r.ca.has_value()) ref_obs.push_back(&r);
    for (const auto& r : mob_chain.residues) if (r.ca.has_value()) mob_obs.push_back(&r);

    auto aligned = align_residues(ref_obs, mob_obs);
    if (aligned.size() < 3) {
        throw CoreError("ERR_NO_COORDINATES", "Insufficient aligned C-alpha coordinates (< 3)");
    }

    std::vector<std::array<double, 3>> ref_pts, mob_pts;
    ref_pts.reserve(aligned.size());
    mob_pts.reserve(aligned.size());
    for (auto [ri, mi] : aligned) {
        ref_pts.push_back(*ref_obs[ri]->ca);
        mob_pts.push_back(*mob_obs[mi]->ca);
    }

    auto [mat, rmsd] = kabsch_superpose(ref_pts, mob_pts);

    ComparisonResult res;
    res.created_at_utc = created_at_utc;
    res.ref_label = ref_label;
    res.ref_structure = ref_structure;
    res.ref_chain_idx = ref_idx;
    res.mob_label = mob_label;
    res.mob_structure = mob_structure;
    res.mob_chain_idx = mob_idx;
    res.matched_ca_count = aligned.size();
    res.rmsd_angstrom = rmsd;
    res.matrix_row_major_4x4 = mat;

    std::string seed = ref_structure.sha256 + ":" + mob_structure.sha256 + ":" +
                       ref_chain.chain_id + ":" + mob_chain.chain_id + ":native-cpp";
    res.result_id = "cmp_" + sha256_hex(seed).substr(0, 16);

    for (auto [ri, mi] : aligned) {
        const Residue* r = ref_obs[ri];
        const Residue* m = mob_obs[mi];
        auto pt = transform_point(mat, *m->ca);
        double dx = pt[0] - (*r->ca)[0];
        double dy = pt[1] - (*r->ca)[1];
        double dz = pt[2] - (*r->ca)[2];
        double dist = std::sqrt(dx * dx + dy * dy + dz * dz);
        res.matched_residues.push_back(MatchedResidue{
            r->seq_id, r->ins_code, m->seq_id, m->ins_code,
            r->res_name3, r->res_code1, dist, r->b_or_plddt, m->b_or_plddt,
        });
    }

    std::size_t ref_denom = std::max<std::size_t>(1, ref_chain.model_residue_count());
    std::size_t mob_denom = std::max<std::size_t>(1, mob_chain.model_residue_count());
    res.ref_coverage = {
        res.matched_ca_count, ref_denom, ref_chain.denominator_kind(),
        std::min(1.0, static_cast<double>(res.matched_ca_count) / static_cast<double>(ref_denom)),
    };
    res.mob_coverage = {
        res.matched_ca_count, mob_denom, mob_chain.denominator_kind(),
        std::min(1.0, static_cast<double>(res.matched_ca_count) / static_cast<double>(mob_denom)),
    };

    res.pae = validate_pae_json(pae_json, mob_chain.model_residue_count());

    for (const auto& lig : ref_structure.ligands) {
        for (const auto& la : lig.atoms) {
            for (const auto& r : ref_chain.residues) {
                for (const auto& pa : r.atoms) {
                    double dx = la.xyz[0] - pa.xyz[0];
                    double dy = la.xyz[1] - pa.xyz[1];
                    double dz = la.xyz[2] - pa.xyz[2];
                    double d = std::sqrt(dx * dx + dy * dy + dz * dz);
                    if (d <= 4.5) {
                        res.ref_contacts.push_back(LigandContact{
                            lig.res_name, lig.chain_id, lig.seq_id, la.name,
                            r.seq_id, r.res_name3, pa.name, d,
                        });
                    }
                }
            }
        }
    }
    return res;
}

std::string ComparisonResult::to_json() const {
    const Chain& rc = ref_structure.chains[ref_chain_idx];
    const Chain& mc = mob_structure.chains[mob_chain_idx];

    std::ostringstream o;
    o << "{";
    o << "\"schemaVersion\":\"1.0.0\",";
    o << "\"ruoNotice\":" << json_escape("Research-Use-Only (RUO). Computational structural comparison output.") << ",";
    o << "\"resultId\":" << json_escape(result_id) << ",";
    o << "\"engine\":{\"name\":\"synlexa-bio-cpp\",\"version\":\"0.1.0\",\"target\":\"native-cpp\",\"floatPrecision\":\"float64\"},";
    o << "\"createdAtUtc\":" << json_escape(created_at_utc) << ",";

    auto write_input = [&](const std::string& label, const Chain& c, const ParsedStructure& s) {
        o << "{";
        o << "\"label\":" << json_escape(label) << ",";
        o << "\"chainId\":" << json_escape(c.chain_id) << ",";
        o << "\"authChainId\":" << json_escape(c.auth_chain_id) << ",";
        o << "\"modelIndex\":" << s.model_index << ",";
        o << "\"sha256\":" << json_escape(s.sha256) << ",";
        o << "\"confidenceKind\":" << json_escape(conf_str(s.confidence_kind)) << ",";
        o << "\"sourceUrl\":null,\"dataRevision\":null,\"retrievedAtUtc\":null,\"license\":null";
        o << "}";
    };

    o << "\"reference\":"; write_input(ref_label, rc, ref_structure); o << ",";
    o << "\"mobile\":"; write_input(mob_label, mc, mob_structure); o << ",";

    o << "\"metrics\":{";
    o << "\"matchedCaCount\":" << matched_ca_count << ",";
    o << "\"rmsdAngstrom\":" << fmt_num(rmsd_angstrom) << ",";
    o << "\"units\":\"angstrom\",";
    o << "\"refCoverage\":{\"numerator\":" << ref_coverage.numerator << ",\"denominator\":" << ref_coverage.denominator
      << ",\"denominatorKind\":" << json_escape(ref_coverage.denominator_kind) << ",\"ratio\":" << fmt_num(ref_coverage.ratio) << "},";
    o << "\"mobCoverage\":{\"numerator\":" << mob_coverage.numerator << ",\"denominator\":" << mob_coverage.denominator
      << ",\"denominatorKind\":" << json_escape(mob_coverage.denominator_kind) << ",\"ratio\":" << fmt_num(mob_coverage.ratio) << "},";
    o << "\"paeStatus\":" << json_escape(pae.status);
    o << "},";

    o << "\"transform\":{\"direction\":\"mobile_to_reference\",\"matrixRowMajor4x4\":[";
    for (std::size_t i = 0; i < 16; ++i) {
        if (i > 0) o << ",";
        o << fmt_num(matrix_row_major_4x4[i]);
    }
    o << "]},";

    o << "\"matchedResidues\":[";
    for (std::size_t i = 0; i < matched_residues.size(); ++i) {
        if (i > 0) o << ",";
        const auto& m = matched_residues[i];
        o << "{\"refSeqId\":" << m.ref_seq_id
          << ",\"refInsCode\":" << json_escape(m.ref_ins_code)
          << ",\"mobSeqId\":" << m.mob_seq_id
          << ",\"mobInsCode\":" << json_escape(m.mob_ins_code)
          << ",\"resName3\":" << json_escape(m.res_name3)
          << ",\"resCode1\":" << json_escape(std::string(1, m.res_code1))
          << ",\"distanceAngstrom\":" << fmt_num(m.distance_angstrom)
          << ",\"refBFactor\":" << (m.ref_b_factor ? fmt_num(*m.ref_b_factor) : "null")
          << ",\"mobPlddt\":" << (m.mob_plddt ? fmt_num(*m.mob_plddt) : "null")
          << "}";
    }
    o << "]";
    o << "}";
    return o.str();
}

} // namespace synlexa::bio
