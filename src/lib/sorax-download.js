/**
 * @fileoverview Accès au téléchargement de Sorax depuis l'interface.
 *
 * Le mot de passe est volontairement écrit **en dur** : ce n'est pas une
 * protection, seulement un sas pour éviter que le projet de Sorax (encore en
 * bêta) ne circule partout pendant la phase de test. Quiconque ouvre le code
 * source le trouve — c'est assumé.
 */

// Mot de passe demandé par le bouton « download sorax ».
export const SORAX_PASSWORD = 'sorax-bff-2026';

// Nom du fichier proposé au téléchargement.
export const SORAX_DOWNLOAD_FILENAME = 'Sorax.sb3';

/**
 * Compare une saisie au mot de passe. La comparaison ignore la casse et les
 * espaces autour, pour rester tolérante aux copier/coller.
 * @param {string} candidate saisie de l'utilisateur
 * @returns {boolean} vrai si le mot de passe est correct
 */
export const checkSoraxPassword = function (candidate) {
    const value = typeof candidate === 'string' ? candidate : '';
    return value.trim().toLowerCase() === SORAX_PASSWORD;
};

/**
 * Lance le téléchargement du projet Sorax (`.sb3`).
 * @param {string} url adresse du fichier à télécharger
 * @param {string} [filename] nom proposé
 */
export const downloadSorax = function (url, filename) {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || SORAX_DOWNLOAD_FILENAME;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
