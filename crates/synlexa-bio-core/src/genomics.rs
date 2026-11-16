//! Seeded GRCh38/MANE Select coding transcripts (CA2, TP53, HBB), custom DNA
//! translation, codon-level nucleotide edit consequence prediction, and
//! +/- strand PAM/protospacer scanner for SpCas9, SaCas9, and Cas12a.

use crate::json::JsonValue;
use crate::{CoreError, RUO_NOTICE};

#[derive(Debug, Clone)]
pub struct TranscriptSpec {
    pub transcript_id: &'static str,
    pub gene_symbol: &'static str,
    pub assembly: &'static str,
    pub cds: &'static str,
}

// Human CA2 (NM_000067.3, GRCh38/MANE) coding sequence translating to UniProt P00918 (260 aa).
const CA2_CDS: &str = concat!(
    "ATGTCCCATCACTGGGGGTACGGCAAACACAACGGACCTGAGCACTGGCATAAGGACTTC",
    "CCCATTGCCAAGGGAGAGCGCCAGTCCCCTGTTGACATCGACACTCATACAGCCAAGTAT",
    "GACCCTTCCCTGAAGCCCCTGTCTGTTTCCTATGATCAAGCAACTTCCCTGAGGATCCTC",
    "AACAATGGTCATGCTTTCAACGTGGAGTTTGATGACTCTCAGGACAAAGCAGTGCTCAAG",
    "GGAGGACCCCTGGATGGCACTTACAGATTGATTCAGTTTCACTTTCACTGGGGTTCACTT",
    "GATGGACAAGGTTCAGAGCATACTGTGGATAAAAAGAAATATGCTGCAGAACTTCACTTG",
    "GTTCACTGGAACACCAAATATGGGGATTTTGGGAAAGCTGTGCAGCAACCTGATGGACTG",
    "GCCGTTCTAGGTATTTTTTTGAAGGTTGGCAGCGCTAAACCGGGCCTTCAGAAAGTTGTT",
    "GATGTGCTGGATTCCATTAAAACAAAGGGCAAGAGTGCTGACTTCACTAACTTCGATCCT",
    "CGTGGCCTCCTTCCTGAATCCCTGGATTACTGGACCTACCCAGGCTCACTGACCACCCCT",
    "CCTCTTCTGGAATGTGTGACCTGGATTGTGCTCAAGGAACCCATCAGCGTCAGCAGCGAG",
    "CAGGTGTTGAAATTCCGTAAACTTAACTTCAATGGGGAGGGTGAACCCGAAGAACTGATG",
    "GTGGACAACTGGCGCCCAGCTCAGCCACTGAAGAACAGGCAAATCAAAGCTTCCTTCAAA"
);

// Human HBB (NM_000518.5, GRCh38/MANE) coding sequence (147 aa).
const HBB_CDS: &str = concat!(
    "ATGGTGCATCTGACTCCTGAGGAGAAGTCTGCCGTTACTGCCCTGTGGGGCAAGGTGAAC",
    "GTGGATGAAGTTGGTGGTGAGGCCCTGGGCAGGCTGCTGGTGGTCTACCCTTGGACCCAG",
    "AGGTTCTTTGAGTCCTTTGGGGATCTGTCCACTCCTGATGCTGTTATGGGCAACCCTAAG",
    "GTGAAGGCTCATGGCAAGAAAGTGCTCGGTGCCTTTAGTGATGGCCTGGCTCACCTGGAC",
    "AACCTCAAGGGCACCTTTGCCACACTGAGTGAGCTGCACTGTGACAAGCTGCACGTGGAT",
    "CCTGAGAACTTCAGGCTCCTGGGCAACGTGCTGGTCTGTGTGCTGGCCCATCACTTTGGC",
    "AAAGAATTCACCCCACCAGTGCAGGCTGCCTATCAGAAAGTGGTGGCTGGTGTGGCTAAT",
    "GCCCTGGCCCACAAGTATCAC"
);

// Human TP53 (NM_000546.6, GRCh38/MANE) coding sequence (393 aa).
const TP53_CDS_FIXED: &str = concat!(
    "ATGGAGGAGCCGCAGTCAGATCCTAGCGTCGAGCCCCCTCTGAGTCAGGAAACATTTTCA",
    "GACCTATGGAAACTACTTCCTGAAAACAACGTTCTGTCCCCCTTGCCGTCCCAAGCAATG",
    "GATGATTTGATGCTGTCCCCGGACGATATTGAACAATGGTTCACTGAAGACCCAGGTCCA",
    "GATGAAGCTCCCAGAATGCCAGAGGCTGCTCCCCCCGTGGCCCCTGCACCAGCAGCTCCT",
    "ACACCGGCGGCCCCTGCACCAGCCCCCTCCTGGCCCCTGTCATCTTCTGTCCCTTCCCAG",
    "AAAACCTACCAGGGCAGCTACGGTTTCCGTCTGGGCTTCTTGCATTCTGGGACAGCCAAG",
    "TCTGTGACTTGCACGTACTCCCCTGCCCTCAACAAGATGTTTTGCCAACTGGCCAAGACC",
    "TGCCCTGTGCAGCTGTGGGTTGATTCCACACCCCCGCCCGGCACCCGCGTCCGCGCCATG",
    "GCCATCTACAAGCAGTCACAGCACATGACGGAGGTTGTGAGGCGCTGCCCCCACCATGAG",
    "CGCTGCTCAGATAGCGATGGTCTGGCCCCTCCTCAGCATCTTATCCGAGTGGAAGGAAAT",
    "TTGCGTGTGGAGTATTTGGATGACAGAAACACTTTTCGACATAGTGTGGTGGTGCCCTAT",
    "GAGCCGCCTGAGGTTGGCTCTGACTGTACCACCATCCACTACAACTACATGTGTAACAGT",
    "TCCTGCATGGGCGGCATGAACCGGAGGCCCATCCTCACCATCATCACACTGGAAGACTCC",
    "AGTGGTAATCTACTGGGACGGAACAGCTTTGAGGTGCGTGTTTGTGCCTGTCCTGGGAGA",
    "GACCGGCGCACAGAGGAAGAGAATCTCCGCAAGAAAGGGGAGCCTCACCACGAGCTGCCC",
    "CCAGGGAGCACTAAGCGAGCACTGCCCAACAACACCAGCTCCTCTCCCCAGCCAAAGAAG",
    "AAACCACTGGATGGAGAATATTTCACCCTTCAGATCCGTGGGCGTGAGCGCTTCGAGATG",
    "TTCCGAGAGCTGAATGAGGCCTTGGAACTCAAGGATGCCCAGGCTGGGAAGGAGCCAGGG",
    "GGGAGCAGGGCTCACTCCAGCCACCTGAAGTCCAAAAAGGGTCAGTCTACCTCCCGCCAT",
    "AAAAAACTCATGTTCAAGACAGAAGGGCCTGACTCAGAC"
);

pub const SEEDED_TRANSCRIPTS: &[TranscriptSpec] = &[
    TranscriptSpec {
        transcript_id: "NM_000067.3",
        gene_symbol: "CA2",
        assembly: "GRCh38/MANE",
        cds: CA2_CDS,
    },
    TranscriptSpec {
        transcript_id: "NM_000546.6",
        gene_symbol: "TP53",
        assembly: "GRCh38/MANE",
        cds: TP53_CDS_FIXED,
    },
    TranscriptSpec {
        transcript_id: "NM_000518.5",
        gene_symbol: "HBB",
        assembly: "GRCh38/MANE",
        cds: HBB_CDS,
    },
];

pub fn translate_codon(codon: &str) -> char {
    match codon.to_ascii_uppercase().as_str() {
        "TTT" | "TTC" => 'F',
        "TTA" | "TTG" | "CTT" | "CTC" | "CTA" | "CTG" => 'L',
        "ATT" | "ATC" | "ATA" => 'I',
        "ATG" => 'M',
        "GTT" | "GTC" | "GTA" | "GTG" => 'V',
        "TCT" | "TCC" | "TCA" | "TCG" | "AGT" | "AGC" => 'S',
        "CCT" | "CCC" | "CCA" | "CCG" => 'P',
        "ACT" | "ACC" | "ACA" | "ACG" => 'T',
        "GCT" | "GCC" | "GCA" | "GCG" => 'A',
        "TAT" | "TAC" => 'Y',
        "TAA" | "TAG" | "TGA" => '*',
        "CAT" | "CAC" => 'H',
        "CAA" | "CAG" => 'Q',
        "AAT" | "AAC" => 'N',
        "AAA" | "AAG" => 'K',
        "GAT" | "GAC" => 'D',
        "GAA" | "GAG" => 'E',
        "TGT" | "TGC" => 'C',
        "TGG" => 'W',
        "CGT" | "CGC" | "CGA" | "CGG" | "AGA" | "AGG" => 'R',
        "GGT" | "GGC" | "GGA" | "GGG" => 'G',
        _ => 'X',
    }
}

pub fn translate_cds(cds: &str) -> String {
    let bytes = cds.as_bytes();
    let mut out = String::with_capacity(bytes.len() / 3);
    for chunk in bytes.chunks_exact(3) {
        let codon = std::str::from_utf8(chunk).unwrap_or("NNN");
        let aa = translate_codon(codon);
        if aa == '*' && out.len() * 3 + 3 == bytes.len() {
            break;
        }
        out.push(aa);
    }
    out
}

fn rev_comp(seq: &str) -> String {
    seq.bytes()
        .rev()
        .map(|b| match b {
            b'A' => 'T',
            b'T' => 'A',
            b'C' => 'G',
            b'G' => 'C',
            _ => 'N',
        })
        .collect()
}

fn gc_percent(seq: &str) -> f64 {
    if seq.is_empty() {
        return 0.0;
    }
    let gc = seq.bytes().filter(|&b| b == b'G' || b == b'C').count();
    (gc as f64) * 100.0 / (seq.len() as f64)
}

#[derive(Debug, Clone)]
pub struct PamSite {
    pub nuclease: String,
    pub pam: String,
    pub strand: char,
    pub protospacer: String,
    pub cut_bp1: usize,
    pub distance_to_target_codon_bp: i64,
    pub gc_percent: f64,
    pub has_poly_t: bool,
}

#[derive(Debug, Clone)]
pub struct GeneCrisprAnalysis {
    pub transcript_id: String,
    pub gene_symbol: String,
    pub assembly: String,
    pub cds_length_bp: usize,
    pub protein_length_aa: usize,
    pub codon_index_1: usize,
    pub dna_start_bp1: usize,
    pub wt_codon: String,
    pub wt_aa: char,
    pub edited_codon: String,
    pub edited_aa: char,
    pub consequence: &'static str,
    pub pam_sites: Vec<PamSite>,
}

impl GeneCrisprAnalysis {
    pub fn to_json(&self) -> JsonValue {
        let pam_json: Vec<JsonValue> = self
            .pam_sites
            .iter()
            .map(|p| {
                JsonValue::object(vec![
                    ("nuclease", JsonValue::String(p.nuclease.clone())),
                    ("pam", JsonValue::String(p.pam.clone())),
                    ("strand", JsonValue::String(p.strand.to_string())),
                    ("protospacer", JsonValue::String(p.protospacer.clone())),
                    ("cutBp1", JsonValue::Number(p.cut_bp1 as f64)),
                    (
                        "distanceToTargetCodonBp",
                        JsonValue::Number(p.distance_to_target_codon_bp as f64),
                    ),
                    ("gcPercent", JsonValue::Number(p.gc_percent)),
                    ("hasPolyT", JsonValue::Bool(p.has_poly_t)),
                ])
            })
            .collect();

        JsonValue::object(vec![
            ("ruoNotice", JsonValue::String(RUO_NOTICE.to_string())),
            ("transcriptId", JsonValue::String(self.transcript_id.clone())),
            ("geneSymbol", JsonValue::String(self.gene_symbol.clone())),
            ("assembly", JsonValue::String(self.assembly.clone())),
            ("cdsLengthBp", JsonValue::Number(self.cds_length_bp as f64)),
            (
                "proteinLengthAa",
                JsonValue::Number(self.protein_length_aa as f64),
            ),
            (
                "targetCodon",
                JsonValue::object(vec![
                    ("codonIndex1", JsonValue::Number(self.codon_index_1 as f64)),
                    ("dnaStartBp1", JsonValue::Number(self.dna_start_bp1 as f64)),
                    ("wtCodon", JsonValue::String(self.wt_codon.clone())),
                    ("wtAa", JsonValue::String(self.wt_aa.to_string())),
                    ("editedCodon", JsonValue::String(self.edited_codon.clone())),
                    ("editedAa", JsonValue::String(self.edited_aa.to_string())),
                    (
                        "consequence",
                        JsonValue::String(self.consequence.to_string()),
                    ),
                ]),
            ),
            ("pamSites", JsonValue::Array(pam_json)),
        ])
    }
}

fn find_transcript(id_or_gene: &str) -> Option<&'static TranscriptSpec> {
    let key = id_or_gene.trim();
    SEEDED_TRANSCRIPTS.iter().find(|t| {
        t.transcript_id.eq_ignore_ascii_case(key) || t.gene_symbol.eq_ignore_ascii_case(key)
    })
}

pub fn analyze_gene_crispr(
    transcript_id: Option<&str>,
    coding_dna: Option<&str>,
    target_codon_index: usize,
    base_edit_index: Option<usize>,
    new_base: Option<&str>,
    nuclease: Option<&str>,
) -> Result<GeneCrisprAnalysis, CoreError> {
    let (tid, gene, assembly, cds) = if let Some(raw_dna) = coding_dna.filter(|s| !s.trim().is_empty()) {
        let cleaned: String = raw_dna
            .chars()
            .filter(|c| !c.is_whitespace())
            .map(|c| c.to_ascii_uppercase())
            .collect();
        if cleaned.len() < 3 || !cleaned.bytes().all(|b| matches!(b, b'A' | b'C' | b'G' | b'T')) {
            return Err(CoreError::new(
                "ERR_INVALID_INPUT",
                "Custom codingDna must contain at least 3 A/C/G/T bases",
            ));
        }
        (
            "CUSTOM".to_string(),
            "CUSTOM".to_string(),
            "User-supplied".to_string(),
            cleaned,
        )
    } else {
        let lookup = transcript_id.unwrap_or("NM_000067.3");
        let spec = find_transcript(lookup).ok_or_else(|| {
            CoreError::new(
                "ERR_INVALID_INPUT",
                format!(
                    "Unknown transcriptId '{}'; seeded IDs: NM_000067.3 (CA2), NM_000546.6 (TP53), NM_000518.5 (HBB)",
                    lookup
                ),
            )
        })?;
        (
            spec.transcript_id.to_string(),
            spec.gene_symbol.to_string(),
            spec.assembly.to_string(),
            spec.cds.to_string(),
        )
    };

    let protein = translate_cds(&cds);
    let protein_len = protein.len();
    if target_codon_index == 0 || target_codon_index > protein_len {
        return Err(CoreError::new(
            "ERR_INVALID_INPUT",
            format!(
                "targetCodonIndex {} out of range 1..={}",
                target_codon_index, protein_len
            ),
        ));
    }

    let dna_start_bp1 = (target_codon_index - 1) * 3 + 1;
    let codon_start0 = dna_start_bp1 - 1;
    let wt_codon = cds[codon_start0..codon_start0 + 3].to_string();
    let wt_aa = translate_codon(&wt_codon);

    let mut edited_chars: Vec<char> = wt_codon.chars().collect();
    if let (Some(edit_idx), Some(base_str)) = (base_edit_index, new_base) {
        let base_ch = base_str
            .trim()
            .chars()
            .next()
            .map(|c| c.to_ascii_uppercase())
            .ok_or_else(|| CoreError::new("ERR_INVALID_INPUT", "newBase cannot be empty"))?;
        if !matches!(base_ch, 'A' | 'C' | 'G' | 'T') {
            return Err(CoreError::new(
                "ERR_INVALID_INPUT",
                format!("Invalid DNA base '{}'; expected A, C, G, or T", base_ch),
            ));
        }
        let within_codon = if (1..=3).contains(&edit_idx) && target_codon_index > 1 {
            edit_idx - 1
        } else if edit_idx >= dna_start_bp1 && edit_idx <= dna_start_bp1 + 2 {
            edit_idx - dna_start_bp1
        } else if (1..=3).contains(&edit_idx) {
            edit_idx - 1
        } else {
            return Err(CoreError::new(
                "ERR_INVALID_INPUT",
                format!(
                    "baseEditIndex {} is outside target codon {} (bp {}..={})",
                    edit_idx,
                    target_codon_index,
                    dna_start_bp1,
                    dna_start_bp1 + 2
                ),
            ));
        };
        edited_chars[within_codon] = base_ch;
    }

    let edited_codon: String = edited_chars.into_iter().collect();
    let edited_aa = translate_codon(&edited_codon);
    let consequence = if edited_codon == wt_codon {
        "unchanged"
    } else if edited_aa == '*' && wt_aa != '*' {
        "nonsense"
    } else if edited_aa == wt_aa {
        "synonymous"
    } else {
        "missense"
    };

    let nuc_choice = nuclease.unwrap_or("SpCas9").trim();
    let scan_sp = nuc_choice.eq_ignore_ascii_case("SpCas9") || nuc_choice.eq_ignore_ascii_case("all");
    let scan_sa = nuc_choice.eq_ignore_ascii_case("SaCas9") || nuc_choice.eq_ignore_ascii_case("all");
    let scan_12a = nuc_choice.eq_ignore_ascii_case("Cas12a") || nuc_choice.eq_ignore_ascii_case("all");
    if !scan_sp && !scan_sa && !scan_12a {
        return Err(CoreError::new(
            "ERR_INVALID_INPUT",
            format!("Unsupported nuclease '{}'; expected SpCas9, SaCas9, or Cas12a", nuc_choice),
        ));
    }

    let target_mid_bp1 = (dna_start_bp1 + 1) as i64;
    let mut sites = Vec::new();
    let bytes = cds.as_bytes();
    let n = bytes.len();

    if scan_sp {
        // + strand: 20bp protospacer + NGG
        for i in 20..=n.saturating_sub(3) {
            if bytes[i + 1] == b'G' && bytes[i + 2] == b'G' {
                let protospacer = cds[i - 20..i].to_string();
                let pam = cds[i..i + 3].to_string();
                let cut_bp1 = (i - 3) + 1;
                sites.push(PamSite {
                    nuclease: "SpCas9".to_string(),
                    pam,
                    strand: '+',
                    gc_percent: gc_percent(&protospacer),
                    has_poly_t: protospacer.contains("TTTT"),
                    protospacer,
                    cut_bp1,
                    distance_to_target_codon_bp: (cut_bp1 as i64) - target_mid_bp1,
                });
            }
        }
        // - strand: CCN + 20bp protospacer (reverse complemented)
        for i in 0..=n.saturating_sub(23) {
            if bytes[i] == b'C' && bytes[i + 1] == b'C' {
                let protospacer = rev_comp(&cds[i + 3..i + 23]);
                let pam = rev_comp(&cds[i..i + 3]);
                let cut_bp1 = (i + 6) + 1;
                sites.push(PamSite {
                    nuclease: "SpCas9".to_string(),
                    pam,
                    strand: '-',
                    gc_percent: gc_percent(&protospacer),
                    has_poly_t: protospacer.contains("TTTT"),
                    protospacer,
                    cut_bp1,
                    distance_to_target_codon_bp: (cut_bp1 as i64) - target_mid_bp1,
                });
            }
        }
    }

    if scan_sa {
        // + strand: 21bp protospacer + NNGRRT (R = A|G)
        for i in 21..=n.saturating_sub(6) {
            if bytes[i + 2] == b'G'
                && matches!(bytes[i + 3], b'A' | b'G')
                && matches!(bytes[i + 4], b'A' | b'G')
                && bytes[i + 5] == b'T'
            {
                let protospacer = cds[i - 21..i].to_string();
                let pam = cds[i..i + 6].to_string();
                let cut_bp1 = (i - 3) + 1;
                sites.push(PamSite {
                    nuclease: "SaCas9".to_string(),
                    pam,
                    strand: '+',
                    gc_percent: gc_percent(&protospacer),
                    has_poly_t: protospacer.contains("TTTT"),
                    protospacer,
                    cut_bp1,
                    distance_to_target_codon_bp: (cut_bp1 as i64) - target_mid_bp1,
                });
            }
        }
        // - strand: AYYCNN (Y = C|T) + 21bp protospacer
        for i in 0..=n.saturating_sub(27) {
            if bytes[i] == b'A'
                && matches!(bytes[i + 1], b'C' | b'T')
                && matches!(bytes[i + 2], b'C' | b'T')
                && bytes[i + 3] == b'C'
            {
                let protospacer = rev_comp(&cds[i + 6..i + 27]);
                let pam = rev_comp(&cds[i..i + 6]);
                let cut_bp1 = (i + 9) + 1;
                sites.push(PamSite {
                    nuclease: "SaCas9".to_string(),
                    pam,
                    strand: '-',
                    gc_percent: gc_percent(&protospacer),
                    has_poly_t: protospacer.contains("TTTT"),
                    protospacer,
                    cut_bp1,
                    distance_to_target_codon_bp: (cut_bp1 as i64) - target_mid_bp1,
                });
            }
        }
    }

    if scan_12a {
        // + strand: TTTV (V = A|C|G) + 23bp protospacer, staggered cut ~21bp after PAM
        for i in 0..=n.saturating_sub(27) {
            if bytes[i] == b'T'
                && bytes[i + 1] == b'T'
                && bytes[i + 2] == b'T'
                && matches!(bytes[i + 3], b'A' | b'C' | b'G')
            {
                let protospacer = cds[i + 4..i + 27].to_string();
                let pam = cds[i..i + 4].to_string();
                let cut_bp1 = (i + 25).min(n - 1) + 1;
                sites.push(PamSite {
                    nuclease: "Cas12a".to_string(),
                    pam,
                    strand: '+',
                    gc_percent: gc_percent(&protospacer),
                    has_poly_t: protospacer.contains("TTTT"),
                    protospacer,
                    cut_bp1,
                    distance_to_target_codon_bp: (cut_bp1 as i64) - target_mid_bp1,
                });
            }
        }
        // - strand: 23bp protospacer + BAAA (B = C|G|T)
        for i in 23..=n.saturating_sub(4) {
            if matches!(bytes[i], b'C' | b'G' | b'T')
                && bytes[i + 1] == b'A'
                && bytes[i + 2] == b'A'
                && bytes[i + 3] == b'A'
            {
                let protospacer = rev_comp(&cds[i - 23..i]);
                let pam = rev_comp(&cds[i..i + 4]);
                let cut_bp1 = i.saturating_sub(21) + 1;
                sites.push(PamSite {
                    nuclease: "Cas12a".to_string(),
                    pam,
                    strand: '-',
                    gc_percent: gc_percent(&protospacer),
                    has_poly_t: protospacer.contains("TTTT"),
                    protospacer,
                    cut_bp1,
                    distance_to_target_codon_bp: (cut_bp1 as i64) - target_mid_bp1,
                });
            }
        }
    }

    sites.sort_by(|a, b| {
        a.distance_to_target_codon_bp
            .abs()
            .cmp(&b.distance_to_target_codon_bp.abs())
            .then_with(|| a.cut_bp1.cmp(&b.cut_bp1))
    });
    sites.truncate(60);

    Ok(GeneCrisprAnalysis {
        transcript_id: tid,
        gene_symbol: gene,
        assembly,
        cds_length_bp: cds.len(),
        protein_length_aa: protein_len,
        codon_index_1: target_codon_index,
        dna_start_bp1,
        wt_codon,
        wt_aa,
        edited_codon,
        edited_aa,
        consequence,
        pam_sites: sites,
    })
}
