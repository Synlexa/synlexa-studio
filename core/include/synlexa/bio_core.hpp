#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace synlexa::bio {

inline constexpr std::size_t kMaxInputBytes = 50ULL * 1024ULL * 1024ULL;
inline constexpr std::size_t kMaxAtoms = 250'000ULL;

struct CoreError : public std::runtime_error {
    std::string code;
    std::vector<std::string> chains;

    CoreError(std::string err_code, const std::string& msg,
              std::vector<std::string> candidate_chains = {})
        : std::runtime_error(msg),
          code(std::move(err_code)),
          chains(std::move(candidate_chains)) {}
};

enum class StructureFormat { Mmcif, Pdb };
enum class ConfidenceKind { ExperimentalBFactor, PredictionPlddt, None };
enum class SourceTypeHint { Auto, Experimental, Prediction };

struct AtomRecord {
    std::string name;
    std::string element;
    std::array<double, 3> xyz{0.0, 0.0, 0.0};
    double occupancy{1.0};
    double b_or_plddt{0.0};
    char alt_loc{' '};
};

struct Residue {
    int seq_id{0};
    std::optional<int> label_seq_id;
    std::string ins_code;
    std::string res_name3;
    char res_code1{'X'};
    std::optional<std::array<double, 3>> ca;
    char ca_alt_loc{' '};
    double ca_occupancy{-1.0};
    std::optional<double> b_or_plddt;
    std::vector<AtomRecord> atoms;
};

struct Chain {
    std::string chain_id;
    std::string auth_chain_id;
    std::vector<Residue> residues;
    std::optional<std::string> declared_sequence;
    bool has_alt_locs{false};
    bool has_insertion_codes{false};

    std::size_t observed_ca_count() const;
    std::size_t model_residue_count() const;
    std::string denominator_kind() const;
};

struct Ligand {
    std::string res_name;
    std::string chain_id;
    int seq_id{0};
    std::string ins_code;
    std::vector<AtomRecord> atoms;
};

struct ParsedStructure {
    std::string sha256;
    StructureFormat format{StructureFormat::Mmcif};
    int model_index{1};
    ConfidenceKind confidence_kind{ConfidenceKind::None};
    std::vector<Chain> chains;
    std::vector<Ligand> ligands;
};

struct CoverageRecord {
    std::size_t numerator{0};
    std::size_t denominator{0};
    std::string denominator_kind;
    double ratio{0.0};
};

struct MatchedResidue {
    int ref_seq_id{0};
    std::string ref_ins_code;
    int mob_seq_id{0};
    std::string mob_ins_code;
    std::string res_name3;
    char res_code1{'X'};
    double distance_angstrom{0.0};
    std::optional<double> ref_b_factor;
    std::optional<double> mob_plddt;
};

struct LigandContact {
    std::string ligand_res_name;
    std::string ligand_chain_id;
    int ligand_seq_id{0};
    std::string ligand_atom;
    int protein_seq_id{0};
    std::string protein_res_name3;
    std::string protein_atom;
    double distance_angstrom{0.0};
};

struct PaeSummary {
    std::string status{"missing"}; // "valid" | "missing" | "incompatible_shape"
    std::size_t size{0};
    std::optional<double> max_pae;
};

struct ComparisonResult {
    std::string result_id;
    std::string created_at_utc;
    std::string ref_label;
    ParsedStructure ref_structure;
    std::size_t ref_chain_idx{0};
    std::string mob_label;
    ParsedStructure mob_structure;
    std::size_t mob_chain_idx{0};
    std::size_t matched_ca_count{0};
    double rmsd_angstrom{0.0};
    CoverageRecord ref_coverage;
    CoverageRecord mob_coverage;
    PaeSummary pae;
    std::array<double, 16> matrix_row_major_4x4{};
    std::vector<MatchedResidue> matched_residues;
    std::vector<LigandContact> ref_contacts;

    std::string to_json() const;
};

std::string sha256_hex(const std::string& data);
char res3_to_1(const std::string& res3);

ParsedStructure parse_structure(const std::string& content,
                                SourceTypeHint hint = SourceTypeHint::Auto);

std::pair<std::array<double, 16>, double> kabsch_superpose(
    const std::vector<std::array<double, 3>>& ref_pts,
    const std::vector<std::array<double, 3>>& mob_pts);

std::array<double, 3> transform_point(const std::array<double, 16>& mat,
                                      const std::array<double, 3>& pt);

PaeSummary validate_pae_json(const std::optional<std::string>& pae_json,
                             std::size_t expected_residues);

ComparisonResult compare_structures(
    const std::string& ref_label,
    const ParsedStructure& ref_structure,
    const std::optional<std::string>& ref_chain_req,
    const std::string& mob_label,
    const ParsedStructure& mob_structure,
    const std::optional<std::string>& mob_chain_req,
    const std::optional<std::string>& pae_json = std::nullopt,
    const std::string& created_at_utc = "2026-11-15T00:00:00Z");

} // namespace synlexa::bio
