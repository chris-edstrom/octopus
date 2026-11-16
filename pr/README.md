# Pull request drafts

One file per branch. The first line is the PR title, the rest is the body.
Screenshots in `img/` are cropped, with the Gitea hostname and username covered.

Open one with:

    gh pr create --repo octopusreview/octopus --head chris-edstrom:<branch> --base master \
      --title "<first line without 'Title: '>" --body-file <(tail -n +3 pr/<file>.md)
