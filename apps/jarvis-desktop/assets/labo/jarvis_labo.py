"""
Boîte à outils du labo de Jarvis : ordres de grandeur fiables pour la
mécanique, l'impression 3D et l'électronique. Unités SI sauf mention
(longueurs en mm, forces en N, contraintes en MPa).

Ce sont des formules de dimensionnement de base (poutres d'Euler-Bernoulli,
matériaux typiques) : pour une pièce critique, vérifier avec les données du
fabricant et un calcul par éléments finis.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# ---------------------------------------------------------------------------
# Matériaux (valeurs typiques ; limite élastique ou résistance à la traction en MPa,
# module d'Young en MPa, masse volumique en g/cm3, température de ramollissement en °C)
# ---------------------------------------------------------------------------

MATERIAUX = {
    "PLA": {"resistance": 50, "E": 3500, "densite": 1.24, "ramollissement": 55, "note": "rigide, cassant, craint la chaleur"},
    "PETG": {"resistance": 45, "E": 2100, "densite": 1.27, "ramollissement": 75, "note": "tenace, bon compromis"},
    "ABS": {"resistance": 40, "E": 2200, "densite": 1.04, "ramollissement": 95, "note": "résiste à la chaleur, se rétracte"},
    "ASA": {"resistance": 45, "E": 2200, "densite": 1.07, "ramollissement": 95, "note": "comme l'ABS, résiste aux UV"},
    "PA-CF": {"resistance": 85, "E": 6000, "densite": 1.15, "ramollissement": 150, "note": "nylon carbone, très rigide"},
    "TPU": {"resistance": 35, "E": 60, "densite": 1.21, "ramollissement": 60, "note": "souple"},
    "alu 6061-T6": {"resistance": 276, "E": 69000, "densite": 2.70, "ramollissement": 400, "note": "limite élastique"},
    "acier S235": {"resistance": 235, "E": 210000, "densite": 7.85, "ramollissement": 600, "note": "limite élastique"},
    "acier inox 304": {"resistance": 215, "E": 193000, "densite": 8.0, "ramollissement": 800, "note": "limite élastique"},
    "bois (hêtre)": {"resistance": 100, "E": 14000, "densite": 0.72, "ramollissement": 150, "note": "flexion, sens du fil"},
}


def materiau(nom: str) -> dict:
    """Propriétés d'un matériau (recherche sans tenir compte des majuscules)."""
    for k, v in MATERIAUX.items():
        if k.lower() == nom.lower() or nom.lower() in k.lower():
            return {"nom": k, **v}
    raise KeyError(f"Matériau inconnu : {nom}. Connus : {', '.join(MATERIAUX)}")


# ---------------------------------------------------------------------------
# Sections : aire (mm²), moment quadratique I (mm⁴), distance à la fibre extrême (mm)
# ---------------------------------------------------------------------------

@dataclass
class Section:
    aire: float
    I: float
    v: float

    @property
    def module(self) -> float:
        """Module de flexion W = I / v (mm³)."""
        return self.I / self.v


def section_rectangle(b: float, h: float) -> Section:
    """Rectangle plein, largeur b, hauteur h (sens de la flexion)."""
    return Section(b * h, b * h ** 3 / 12, h / 2)


def section_tube_rond(D: float, d: float = 0.0) -> Section:
    """Tube rond (d = 0 pour un rond plein)."""
    return Section(math.pi * (D ** 2 - d ** 2) / 4, math.pi * (D ** 4 - d ** 4) / 64, D / 2)


def section_tube_carre(B: float, e: float) -> Section:
    """Tube carré de côté B et d'épaisseur e."""
    b = B - 2 * e
    return Section(B * B - b * b, (B ** 4 - b ** 4) / 12, B / 2)


# ---------------------------------------------------------------------------
# Poutres
# ---------------------------------------------------------------------------

def poutre_console(F: float, L: float, section: Section, E: float) -> dict:
    """Poutre encastrée d'un côté, force F (N) au bout, longueur L (mm)."""
    M = F * L
    return {"moment_Nmm": M, "contrainte_MPa": M / section.module, "fleche_mm": F * L ** 3 / (3 * E * section.I)}


def poutre_deux_appuis(F: float, L: float, section: Section, E: float) -> dict:
    """Poutre sur deux appuis, force F (N) au milieu."""
    M = F * L / 4
    return {"moment_Nmm": M, "contrainte_MPa": M / section.module, "fleche_mm": F * L ** 3 / (48 * E * section.I)}


def coefficient_securite(contrainte: float, resistance: float) -> float:
    """Résistance / contrainte. Viser au moins 2 (3 ou plus en impression 3D, 4 pour un choc)."""
    return math.inf if contrainte <= 0 else resistance / contrainte


def impression_3d(nom: str, remplissage_pct: float = 40, perimetres: int = 3, sens: str = "XY") -> dict:
    """
    Résistance réaliste d'une pièce imprimée : moins que le matériau massif,
    et beaucoup moins entre les couches (sens Z).
    """
    m = materiau(nom)
    facteur = 0.35 + 0.004 * remplissage_pct + 0.05 * min(perimetres, 6)
    facteur = min(facteur, 0.9)
    if sens.upper() == "Z":
        facteur *= 0.5
    return {"materiau": m["nom"], "resistance_MPa": round(m["resistance"] * facteur, 1), "E_MPa": round(m["E"] * min(1.0, facteur + 0.1)), "facteur": round(facteur, 2)}


def masse(volume_cm3: float, nom: str, remplissage_pct: float = 100) -> float:
    """Masse en grammes."""
    return volume_cm3 * materiau(nom)["densite"] * (0.25 + 0.75 * remplissage_pct / 100 if remplissage_pct < 100 else 1)


# ---------------------------------------------------------------------------
# Visserie
# ---------------------------------------------------------------------------

def couple_serrage(diametre_mm: float, classe: str = "8.8", frottement: float = 0.14) -> dict:
    """Couple de serrage indicatif (N·m) d'une vis métrique à pas gros, à 90 % de la limite élastique."""
    pas = {3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25, 10: 1.5, 12: 1.75, 14: 2.0, 16: 2.0}.get(round(diametre_mm), diametre_mm * 0.15)
    re = {"4.6": 240, "5.6": 300, "8.8": 640, "10.9": 940, "12.9": 1100, "A2-70": 450, "A4-80": 600}[classe]
    d2 = diametre_mm - 0.6495 * pas
    d3 = diametre_mm - 1.2269 * pas
    As = math.pi / 4 * ((d2 + d3) / 2) ** 2
    F = 0.9 * re * As * 0.7
    K = 0.16 * pas / diametre_mm + 0.58 * frottement * d2 / diametre_mm + frottement * 0.7
    return {"section_resistante_mm2": round(As, 1), "precharge_N": round(F), "couple_Nm": round(K * F * diametre_mm / 1000, 1)}


# ---------------------------------------------------------------------------
# Électronique
# ---------------------------------------------------------------------------

SERIES = {
    "E12": [1.0, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2],
    "E24": [1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0, 3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1],
}


def valeur_normalisee(valeur: float, serie: str = "E24") -> float:
    """Valeur de résistance (ou condensateur) normalisée la plus proche."""
    if valeur <= 0:
        raise ValueError("valeur positive attendue")
    decade = 10 ** math.floor(math.log10(valeur))
    candidats = [v * decade for v in SERIES[serie]] + [10 * decade]
    return min(candidats, key=lambda v: abs(math.log(v / valeur)))


def resistance_led(tension_alim: float, tension_led: float = 2.0, courant_mA: float = 15) -> dict:
    """Résistance série d'une LED."""
    r = (tension_alim - tension_led) / (courant_mA / 1000)
    rn = valeur_normalisee(r)
    return {"calculee_ohm": round(r, 1), "normalisee_ohm": rn, "puissance_W": round((tension_alim - tension_led) ** 2 / rn, 3)}


def diviseur_tension(vin: float, r1: float, r2: float) -> float:
    """Tension de sortie d'un pont diviseur (sortie sur r2)."""
    return vin * r2 / (r1 + r2)


def constante_rc(r_ohm: float, c_farad: float) -> dict:
    tau = r_ohm * c_farad
    return {"tau_s": tau, "frequence_coupure_Hz": 1 / (2 * math.pi * tau)}


def autonomie_batterie(capacite_mAh: float, conso_mA: float, rendement: float = 0.85) -> float:
    """Autonomie en heures."""
    return capacite_mAh * rendement / conso_mA


def section_cable(courant_A: float, longueur_m: float, chute_max_pct: float = 3, tension: float = 12, cuivre: bool = True) -> dict:
    """Section minimale d'un câble (aller-retour) pour une chute de tension donnée."""
    rho = 0.0172 if cuivre else 0.0282
    s = 2 * rho * longueur_m * courant_A / (tension * chute_max_pct / 100)
    normalisees = [0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25]
    return {"calculee_mm2": round(s, 2), "conseillee_mm2": next((n for n in normalisees if n >= s), s)}


if __name__ == "__main__":
    s = section_rectangle(20, 8)
    r = poutre_console(F=60, L=80, section=s, E=impression_3d("PETG")["E_MPa"])
    print(r, coefficient_securite(r["contrainte_MPa"], impression_3d("PETG")["resistance_MPa"]))
    print(resistance_led(5), couple_serrage(6), section_cable(10, 3))
