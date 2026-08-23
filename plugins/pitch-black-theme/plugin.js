export default {
  apiVersion: 2,
  id: 'pitch-black-theme',
  name: 'Pitch Black Theme',
  version: '1.0.0',
  description: 'A true-black, AMOLED-friendly theme for Avi.',
  contributions: {
    themes: [
      {
        id: 'pitch-black-amoled',
        name: 'Pitch Black',
        tagline: 'True-black surfaces with crisp contrast and a cool mint pulse.',
        emptyChatBackground: false,
        css: `
          :root[data-theme="pitch-black-amoled"] {
            color-scheme: dark;
            --primary-color: #2de2b6;
            --primary-color-opaque: #2de2b622;
            --text-1: #f5f7f6;
            --text-2: #c7cecb;
            --text-3: #969f9c;
            --text-4: #626a67;
            --text-5: #050706;
            --background-0: #000000;
            --background-1: #030403;
            --background-2: #080a09;
            --background-3: #101311;
            --background-4: #1b201e;
            --background-5: #f5f7f6;
            --highlight-color: #145c4c;
            --success-color: #55d69e;
            --warn-color: #e0ad4f;
            --danger-color: #ff747d;
            --git-ignored-status-color: #747d7a;
            --diff-removed-bg: #36161a;
            --diff-added-bg: #0d3024;
            --diff-relative-margin-bg: #ffffff10;
            --prism-comment: #77817d;
            --prism-punctuation: #c9d0cd;
            --prism-property: #ffb86c;
            --prism-selector: #69e6a6;
            --prism-operator: #ff7b86;
            --prism-keyword: #ff7b86;
            --prism-function: #c9a7ff;
            --prism-string: #8bdcff;
            --prism-number: #79b8ff;
            --prism-class: #ffb86c;
          }
        `,
      },
    ],
  },
};
