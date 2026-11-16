#include "synlexa/bio_core.hpp"

#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

#define CHECK(cond)                                                                                \
    do {                                                                                           \
        if (!(cond)) {                                                                             \
            std::cerr << "CHECK FAILED at " << __FILE__ << ":" << __LINE__ << ": " << #cond << "\n"; \
            std::exit(1);                                                                          \
        }                                                                                          \
    } while (0)

namespace {

std::string read_fixture(const std::string& filename) {
    std::string path = std::string(SYNLEXA_FIXTURES_DIR) + "/" + filename;
    std::ifstream ifs(path, std::ios::binary);
    CHECK(ifs.good());
    std::ostringstream ss;
    ss << ifs.rdbuf();
    return ss.str();
}

void test_synthetic_rigid_transform() {
    std::vector<std::array<double, 3>> ref_pts = {
        {1.2, -0.5, 3.1}, {4.5, 2.1, 0.8}, {6.3, -1.9, 4.4},
        {2.0, 5.4, -2.3}, {-3.1, 1.7, 2.9}, {0.4, -4.2, -1.1},
    };
    double theta = 0.73;
    double c = std::cos(theta);
    double s = std::sin(theta);
    double rot[3][3] = {{c, -s, 0.0}, {s, c, 0.0}, {0.0, 0.0, 1.0}};
    double t[3] = {12.5, -8.25, 4.75};

    std::vector<std::array<double, 3>> mob_pts;
    for (const auto& p : ref_pts) {
        mob_pts.push_back({
            rot[0][0] * p[0] + rot[0][1] * p[1] + rot[0][2] * p[2] + t[0],
            rot[1][0] * p[0] + rot[1][1] * p[1] + rot[1][2] * p[2] + t[1],
            rot[2][0] * p[0] + rot[2][1] * p[1] + rot[2][2] * p[2] + t[2],
        });
    }

    auto [mat, rmsd] = synlexa::bio::kabsch_superpose(ref_pts, mob_pts);
    CHECK(rmsd < 1e-6);
    for (std::size_t i = 0; i < ref_pts.size(); ++i) {
        auto rec = synlexa::bio::transform_point(mat, mob_pts[i]);
        double d = std::hypot(rec[0] - ref_pts[i][0],
                              std::hypot(rec[1] - ref_pts[i][1], rec[2] - ref_pts[i][2]));
        CHECK(d < 1e-6);
    }
    // det(R) = +1 check
    double det = mat[0] * (mat[5] * mat[10] - mat[6] * mat[9]) -
                 mat[1] * (mat[4] * mat[10] - mat[6] * mat[8]) +
                 mat[2] * (mat[4] * mat[9] - mat[5] * mat[8]);
    CHECK(std::abs(det - 1.0) < 1e-9);
}

void test_missing_coords_coverage() {
    std::string ref_cif =
        "data_ref\n"
        "_entity_poly.entity_id 1\n"
        "_entity_poly.pdbx_seq_one_letter_code_can AGVLK\n"
        "loop_\n"
        "_atom_site.group_PDB\n_atom_site.label_atom_id\n_atom_site.label_comp_id\n"
        "_atom_site.label_asym_id\n_atom_site.label_seq_id\n_atom_site.Cartn_x\n"
        "_atom_site.Cartn_y\n_atom_site.Cartn_z\n_atom_site.auth_seq_id\n"
        "ATOM CA ALA A 1 0.0 0.0 0.0 1\n"
        "ATOM CA GLY A 2 3.8 0.0 0.0 2\n"
        "ATOM CA LEU A 4 7.6 1.2 0.0 4\n"
        "ATOM CA LYS A 5 11.4 0.0 0.0 5\n";
    std::string mob_cif =
        "data_mob\n"
        "loop_\n"
        "_atom_site.group_PDB\n_atom_site.label_atom_id\n_atom_site.label_comp_id\n"
        "_atom_site.label_asym_id\n_atom_site.label_seq_id\n_atom_site.Cartn_x\n"
        "_atom_site.Cartn_y\n_atom_site.Cartn_z\n_atom_site.auth_seq_id\n"
        "ATOM CA ALA A 1 0.0 0.0 0.0 1\n"
        "ATOM CA GLY A 2 3.8 0.0 0.0 2\n"
        "ATOM CA VAL A 3 5.7 1.5 0.0 3\n"
        "ATOM CA LEU A 4 7.6 1.2 0.0 4\n"
        "ATOM CA LYS A 5 11.4 0.0 0.0 5\n";

    auto r = synlexa::bio::parse_structure(ref_cif);
    auto m = synlexa::bio::parse_structure(mob_cif);
    auto cmp = synlexa::bio::compare_structures("ref", r, "A", "mob", m, "A");
    CHECK(cmp.matched_ca_count == 4);
    CHECK(cmp.ref_coverage.numerator == 4);
    CHECK(cmp.ref_coverage.denominator == 5);
    CHECK(cmp.ref_coverage.denominator_kind == "declared_polymer_sequence");
    CHECK(cmp.mob_coverage.numerator == 4);
    CHECK(cmp.mob_coverage.denominator == 5);
    CHECK(cmp.mob_coverage.denominator_kind == "coordinate_only");
    CHECK(cmp.rmsd_angstrom < 1e-6);
}

void test_ambiguous_chain() {
    std::string two_chains =
        "ATOM      1  CA  ALA A   1       1.000   2.000   3.000  1.00 10.00           C  \n"
        "ATOM      2  CA  GLY A   2       4.000   2.000   3.000  1.00 10.00           C  \n"
        "ATOM      3  CA  VAL A   3       7.000   2.000   3.000  1.00 10.00           C  \n"
        "ATOM      4  CA  ALA B   1       1.000   5.000   3.000  1.00 10.00           C  \n"
        "ATOM      5  CA  GLY B   2       4.000   5.000   3.000  1.00 10.00           C  \n"
        "ATOM      6  CA  VAL B   3       7.000   5.000   3.000  1.00 10.00           C  \n";
    auto p1 = synlexa::bio::parse_structure(two_chains);
    auto p2 = synlexa::bio::parse_structure(two_chains);
    bool caught = false;
    try {
        (void)synlexa::bio::compare_structures("r", p1, std::nullopt, "m", p2, "A");
    } catch (const synlexa::bio::CoreError& e) {
        caught = (e.code == "ERR_AMBIGUOUS_CHAIN" && e.chains.size() == 2);
    }
    CHECK(caught);
}

void test_altlocs_and_ins_codes() {
    std::string pdb =
        "ATOM      1  CA AALA A  10A      1.000   0.000   0.000  0.30 12.00           C  \n"
        "ATOM      2  CA BALA A  10A      2.000   0.000   0.000  0.70 12.00           C  \n"
        "ATOM      3  CA  GLY A  10B      5.000   0.000   0.000  1.00 14.00           C  \n"
        "ATOM      4  CA  VAL A  11       8.000   0.000   0.000  1.00 16.00           C  \n";
    auto parsed = synlexa::bio::parse_structure(pdb);
    CHECK(parsed.chains.size() == 1);
    CHECK(parsed.chains[0].has_alt_locs);
    CHECK(parsed.chains[0].has_insertion_codes);
    CHECK(parsed.chains[0].residues.size() == 3);
    CHECK(parsed.chains[0].residues[0].ca->at(0) == 2.0);
    CHECK(parsed.chains[0].residues[0].ins_code == "A");
}

void test_malformed_and_oversized() {
    bool caught_empty = false;
    try {
        (void)synlexa::bio::parse_structure("   \n");
    } catch (const synlexa::bio::CoreError& e) {
        caught_empty = (e.code == "ERR_MALFORMED_STRUCTURE");
    }
    CHECK(caught_empty);

    bool caught_nocoords = false;
    try {
        (void)synlexa::bio::parse_structure("HEADER    EMPTY\nREMARK   1 NONE\n");
    } catch (const synlexa::bio::CoreError& e) {
        caught_nocoords = (e.code == "ERR_NO_COORDINATES");
    }
    CHECK(caught_nocoords);

    bool caught_over = false;
    try {
        std::string huge(synlexa::bio::kMaxInputBytes + 1, 'A');
        (void)synlexa::bio::parse_structure(huge);
    } catch (const synlexa::bio::CoreError& e) {
        caught_over = (e.code == "ERR_OVERSIZED_INPUT");
    }
    CHECK(caught_over);
}

void test_3hs4_vs_af_p00918_v6() {
    auto ref_cif = read_fixture("3HS4.cif");
    auto mob_cif = read_fixture("AF-P00918-F1-model_v6.cif");
    auto pae_json = read_fixture("AF-P00918-F1-predicted_aligned_error_v6.json");

    auto r = synlexa::bio::parse_structure(ref_cif);
    auto m = synlexa::bio::parse_structure(mob_cif);
    CHECK(r.sha256 == "84e006ac301979de150f351fdc235a97ba73bffec8514dfe6c96447517da91d6");
    CHECK(m.sha256 == "173c4f1fa81ffb1a288c881040217d1473ed2d08cd792671252ee116cac10c7d");
    CHECK(r.confidence_kind == synlexa::bio::ConfidenceKind::ExperimentalBFactor);
    CHECK(m.confidence_kind == synlexa::bio::ConfidenceKind::PredictionPlddt);

    auto cmp = synlexa::bio::compare_structures("3HS4.cif", r, "A",
                                                "AF-P00918-F1-model_v6.cif", m, "A",
                                                pae_json);
    CHECK(cmp.matched_ca_count == 257);
    CHECK(cmp.ref_coverage.numerator == 257);
    CHECK(cmp.ref_coverage.denominator == 260);
    CHECK(cmp.pae.status == "valid");
    CHECK(cmp.pae.size == 260);
    CHECK(std::abs(cmp.rmsd_angstrom - 0.368394267723) < 1e-6);
    CHECK(!cmp.ref_contacts.empty());
}

} // namespace

int main() {
    test_synthetic_rigid_transform();
    test_missing_coords_coverage();
    test_ambiguous_chain();
    test_altlocs_and_ins_codes();
    test_malformed_and_oversized();
    test_3hs4_vs_af_p00918_v6();
    std::cout << "All C++20 bio_core tests passed.\n";
    return 0;
}
