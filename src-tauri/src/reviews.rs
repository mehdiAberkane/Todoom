use super::*;

// ---- Pull / merge requests ------------------------------------------------------
// The open pull requests (GitHub) or merge requests (GitLab) of a board's
// repository, read through the gh and glab tools already signed in on this
// computer: Todoom stores no token. The repository comes from the board's file,
// which anyone who can write the synced folder controls: host and path are
// checked, the arguments are fixed and no shell is involved.

pub(crate) const REVIEW_TIMEOUT: Duration = Duration::from_secs(25);

/// A host name: letters, digits, dots and dashes.
pub(crate) fn is_forge_host(host: &str) -> bool {
    !host.is_empty()
        && host.len() <= 253
        && !host.starts_with(['-', '.'])
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
}

/// owner/repo on GitHub, group/…/project on GitLab: plain names, never an option or "..".
pub(crate) fn is_forge_path(forge: &str, path: &str) -> bool {
    let parts: Vec<&str> = path.split('/').collect();
    let count_ok = match forge {
        "github" => parts.len() == 2,
        "gitlab" => (2..=20).contains(&parts.len()),
        _ => false,
    };
    count_ok
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.len() <= 100
                && !p.starts_with(['-', '.'])
                && p.chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
        })
}

/// One question per repository and per look (one gh or glab launched, not two):
/// the open ones, the latest merged ones (the interface keeps the last 24 hours),
/// and the release under way: the pipeline of the latest tag, and its release page
/// (TOD-78). Read by gitlabReviews in reviews.ts.
pub(crate) const GITLAB_QUERY: &str = "query($path: ID!) { project(fullPath: $path) { \
open: mergeRequests(state: opened, first: 50, sort: UPDATED_DESC) { nodes { ...M } } \
merged: mergeRequests(state: merged, first: 20, sort: MERGED_AT_DESC) { nodes { ...M } } \
tags: pipelines(scope: TAGS, first: 1) { nodes { ref status path createdAt updatedAt } } \
releases(first: 1, sort: RELEASED_AT_DESC) { nodes { tagName links { selfUrl } } } } } \
fragment M on MergeRequest { iid title webUrl draft sourceBranch updatedAt mergedAt author { username } headPipeline { status } }";

/// The same for GitHub, with each check of the last commit (the CI state is worked
/// out as before, in ciOfChecks), and the release under way: the workflows the latest
/// tag started (their check suites carry the tag's name), and its release page (TOD-78).
/// Read by githubReviews in reviews.ts.
pub(crate) const GITHUB_QUERY: &str = "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { \
open: pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...P } } \
merged: pullRequests(states: MERGED, first: 20, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...P } } \
tags: refs(refPrefix: \"refs/tags/\", first: 1, orderBy: {field: TAG_COMMIT_DATE, direction: DESC}) { nodes { name \
target { ... on Commit { ...R } ... on Tag { target { ... on Commit { ...R } } } } } } \
releases(first: 1, orderBy: {field: CREATED_AT, direction: DESC}) { nodes { tagName url } } } } \
fragment R on Commit { checkSuites(first: 30) { nodes { status conclusion branch { name } \
workflowRun { url createdAt updatedAt } } } } \
fragment P on PullRequest { number title url isDraft headRefName updatedAt mergedAt author { __typename login } \
commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) { nodes { __typename \
... on CheckRun { status conclusion } ... on StatusContext { state } } } } } } } }";

/// The hosts each tool talks to by default; any other one must be allowed on this computer.
pub(crate) const DEFAULT_FORGE_HOSTS: [&str; 2] = ["github.com", "gitlab.com"];

/// May the PR/MR panel contact this host? The repository comes from the board's file,
/// which anyone who can write the synced folder chooses: a host other than github.com
/// or gitlab.com is contacted only once the user allowed it here. Err holds the code
/// the interface explains: "unapproved:<host>" (to ask) or "refused:<host>".
pub(crate) fn forge_host_allowed(
    forge: &str,
    host: &str,
    choices: &HashMap<String, bool>,
) -> Result<(), String> {
    let host = host.to_ascii_lowercase();
    match forge {
        // Todoom reads GitHub at github.com only (gh would send GH_ENTERPRISE_TOKEN elsewhere).
        "github" if host == "github.com" => Ok(()),
        "github" => Err("badrepo".into()),
        _ if DEFAULT_FORGE_HOSTS.contains(&host.as_str()) => Ok(()),
        _ => match choices.get(&host) {
            Some(true) => Ok(()),
            Some(false) => Err(format!("refused:{host}")),
            None => Err(format!("unapproved:{host}")),
        },
    }
}

/// Token variables a tool would attach to a request whatever the host: removed from
/// its environment unless the host is the tool's own default, so an allowed GitLab
/// instance only ever gets the token glab keeps for that very host.
pub(crate) fn token_vars_to_drop(tool: &str, host: &str) -> &'static [&'static str] {
    match (
        tool,
        host.eq_ignore_ascii_case(if tool == "gh" {
            "github.com"
        } else {
            "gitlab.com"
        }),
    ) {
        ("gh", true) => &["GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_HOST"],
        ("gh", false) => &[
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "GH_ENTERPRISE_TOKEN",
            "GITHUB_ENTERPRISE_TOKEN",
            "GH_HOST",
        ],
        (_, true) => &["GITLAB_HOST", "GL_HOST"],
        _ => &[
            "GITLAB_TOKEN",
            "GITLAB_ACCESS_TOKEN",
            "OAUTH_TOKEN",
            "CI_JOB_TOKEN",
            "GITLAB_HOST",
            "GL_HOST",
        ],
    }
}

/// The command line for a forge, arguments as a list: one GraphQL question for the
/// open pull/merge requests and the latest merged ones. The repository goes in
/// variables (-f: always a string), never into the query text.
pub(crate) fn review_args(
    forge: &str,
    host: &str,
    path: &str,
) -> Option<(&'static str, Vec<String>)> {
    if !is_forge_host(host) || !is_forge_path(forge, path) {
        return None;
    }
    match forge {
        "github" => {
            let (owner, name) = path.split_once('/')?;
            Some((
                "gh",
                [
                    "api",
                    "graphql",
                    "--hostname",
                    host,
                    "-f",
                    &format!("query={GITHUB_QUERY}"),
                    "-f",
                    &format!("owner={owner}"),
                    "-f",
                    &format!("name={name}"),
                ]
                .map(String::from)
                .to_vec(),
            ))
        }
        "gitlab" => Some((
            "glab",
            [
                "api",
                "graphql",
                "--hostname",
                host,
                "-f",
                &format!("query={GITLAB_QUERY}"),
                "-f",
                &format!("path={path}"),
            ]
            .map(String::from)
            .to_vec(),
        )),
        _ => None,
    }
}

/// Where gh or glab is: on the PATH, else where their installers put them
/// (an app opened from the Dock or the Start menu doesn't get the shell's PATH).
pub(crate) fn find_tool(name: &str) -> Option<PathBuf> {
    let exe = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).collect())
        .unwrap_or_default();
    if cfg!(windows) {
        for var in ["ProgramFiles", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
                dirs.push(base.join("GitHub CLI"));
                dirs.push(base.join("Programs").join(name));
                dirs.push(base.join("Programs").join("GitHub CLI"));
            }
        }
    } else {
        dirs.extend(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].map(PathBuf::from));
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            dirs.push(home.join(".local/bin"));
        }
    }
    dirs.into_iter().map(|d| d.join(&exe)).find(|p| p.is_file())
}

/// Runs the tool and returns its output, or an error code the interface explains:
/// "missing:<tool>", "auth:<tool>", "notfound", or "failed:<message>".
pub(crate) fn run_review_tool(tool: &str, host: &str, args: &[String]) -> Result<String, String> {
    let program = find_tool(tool).ok_or_else(|| format!("missing:{tool}"))?;
    let mut cmd = std::process::Command::new(program);
    for var in token_vars_to_drop(tool, host) {
        cmd.env_remove(var);
    }
    cmd.args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        // No colors, no prompts, no pager: plain JSON.
        .env("NO_COLOR", "1")
        .env("GH_PROMPT_DISABLED", "1")
        .env("GLAB_NO_PROMPT", "1")
        .env("GH_PAGER", "")
        .env("PAGER", "");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flashing
    }
    let mut child = cmd.spawn().map_err(|e| format!("failed:{e}"))?;
    // Read both pipes on threads, so a full pipe never blocks the tool.
    let mut out_pipe = child.stdout.take();
    let mut err_pipe = child.stderr.take();
    let out = thread::spawn(move || {
        let mut s = String::new();
        if let Some(p) = out_pipe.as_mut() {
            let _ = std::io::Read::read_to_string(p, &mut s);
        }
        s
    });
    let err = thread::spawn(move || {
        let mut s = String::new();
        if let Some(p) = err_pipe.as_mut() {
            let _ = std::io::Read::read_to_string(p, &mut s);
        }
        s
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| format!("failed:{e}"))? {
            break status;
        }
        if started.elapsed() > REVIEW_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("failed:{tool} timeout"));
        }
        thread::sleep(Duration::from_millis(100));
    };
    let stdout = out.join().unwrap_or_default();
    let stderr = err.join().unwrap_or_default();
    if status.success() {
        return Ok(stdout);
    }
    Err(review_error(tool, &stderr))
}

/// The error code for what the tool wrote on failure.
pub(crate) fn review_error(tool: &str, stderr: &str) -> String {
    let lower = stderr.to_lowercase();
    const SIGNED_OUT: [&str; 6] = [
        "auth login",
        "not logged",
        "401",
        "unauthorized",
        "invalid token",
        "token is expired",
    ];
    if SIGNED_OUT.iter().any(|w| lower.contains(w)) {
        format!("auth:{tool}")
    } else if lower.contains("could not resolve")
        || lower.contains("404")
        || lower.contains("not found")
    {
        "notfound".to_string()
    } else {
        let line = stderr
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or("?");
        format!("failed:{}", line.chars().take(200).collect::<String>())
    }
}

/// The open pull/merge requests of a repository and its latest merged ones, as the
/// tool's GraphQL answer ({ open, merged }, see GITHUB_QUERY and GITLAB_QUERY).
#[tauri::command]
pub(crate) async fn list_reviews(
    app: AppHandle,
    forge: String,
    host: String,
    path: String,
) -> Result<String, String> {
    blocking(app, move |app| {
        let (tool, args) =
            review_args(&forge, &host, &path).ok_or_else(|| "badrepo".to_string())?;
        let choices = app
            .state::<AppState>()
            .config
            .lock()
            .unwrap()
            .forge_hosts
            .clone();
        forge_host_allowed(&forge, &host, &choices)?;
        run_review_tool(tool, &host, &args)
    })
    .await
}

/// The hosts allowed (true) or refused (false) on this computer.
#[tauri::command]
pub(crate) fn forge_hosts(state: State<AppState>) -> HashMap<String, bool> {
    state.config.lock().unwrap().forge_hosts.clone()
}

/// The user's answer for a host, kept in this computer's settings (not in Drive).
#[tauri::command]
pub(crate) async fn set_forge_host(
    app: AppHandle,
    host: String,
    allowed: bool,
) -> Result<(), String> {
    blocking(app, move |app| {
        let host = host.to_ascii_lowercase();
        if !is_forge_host(&host) || DEFAULT_FORGE_HOSTS.contains(&host.as_str()) {
            return Err("badrepo".into());
        }
        let state = app.state::<AppState>();
        let mut cfg = state.config.lock().unwrap();
        cfg.forge_hosts.insert(host, allowed);
        save_config(app, &cfg)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn review_commands_take_only_plain_repositories() {
        let (tool, args) = review_args("github", "github.com", "mehdiAberkane/Todoom").unwrap();
        assert_eq!(tool, "gh");
        assert_eq!(&args[..4], ["api", "graphql", "--hostname", "github.com"]);
        assert!(args.contains(&"owner=mehdiAberkane".to_string()));
        assert!(args.contains(&"name=Todoom".to_string()));
        // One launch brings both lists.
        let query = args.iter().find(|a| a.starts_with("query=")).unwrap();
        assert!(query.contains("states: OPEN") && query.contains("states: MERGED"));
        assert!(!query.contains("Todoom"), "the repository is a variable");
        let (tool, args) = review_args("gitlab", "gitlab.example.com", "g/sub/project").unwrap();
        assert_eq!(tool, "glab");
        assert!(args.contains(&"path=g/sub/project".to_string()));
        assert!(args.contains(&"gitlab.example.com".to_string()));
        let query = args.iter().find(|a| a.starts_with("query=")).unwrap();
        assert!(query.contains("state: opened") && query.contains("state: merged"));
        for (forge, host, path) in [
            ("github", "github.com", "a/b/c"),
            ("github", "github.com", "../b"),
            ("github", "github.com", "-x/b"),
            ("github", "github.com", "a/b;rm"),
            ("github", "-h", "a/b"),
            ("github", "evil.com/x", "a/b"),
            ("gitlab", "gitlab.com", "single"),
            ("gitlab", "gitlab.com", "g/.hidden"),
            ("bitbucket", "bitbucket.org", "a/b"),
            ("github", "github.com", "a b/c"),
        ] {
            assert!(
                review_args(forge, host, path).is_none(),
                "{forge} {host} {path}"
            );
        }
    }

    #[test]
    fn only_allowed_forge_hosts_are_contacted() {
        let mut choices = HashMap::new();
        assert_eq!(forge_host_allowed("github", "github.com", &choices), Ok(()));
        assert_eq!(forge_host_allowed("gitlab", "GitLab.com", &choices), Ok(()));
        // GitHub elsewhere than github.com: never (gh would hand it GH_ENTERPRISE_TOKEN).
        assert_eq!(
            forge_host_allowed("github", "evil.test", &choices),
            Err("badrepo".into())
        );
        // A host named in a board file: asked first, then the answer stands.
        assert_eq!(
            forge_host_allowed("gitlab", "evil.test", &choices),
            Err("unapproved:evil.test".into())
        );
        choices.insert("evil.test".into(), false);
        assert_eq!(
            forge_host_allowed("gitlab", "evil.test", &choices),
            Err("refused:evil.test".into())
        );
        choices.insert("git.example.fr".into(), true);
        assert_eq!(
            forge_host_allowed("gitlab", "git.example.fr", &choices),
            Ok(())
        );
    }

    #[test]
    fn token_variables_only_reach_the_tools_own_host() {
        // glab sends GITLAB_TOKEN / GITLAB_ACCESS_TOKEN to any host (checked: Private-Token header).
        assert!(token_vars_to_drop("glab", "git.example.fr").contains(&"GITLAB_TOKEN"));
        assert!(token_vars_to_drop("glab", "git.example.fr").contains(&"GITLAB_ACCESS_TOKEN"));
        assert!(!token_vars_to_drop("glab", "gitlab.com").contains(&"GITLAB_TOKEN"));
        assert!(!token_vars_to_drop("gh", "github.com").contains(&"GH_TOKEN"));
        assert!(token_vars_to_drop("gh", "github.com").contains(&"GH_ENTERPRISE_TOKEN"));
    }

    #[test]
    fn review_errors_say_what_to_do() {
        assert_eq!(review_error("glab", "glab: Invalid token"), "auth:glab");
        assert_eq!(
            review_error(
                "gh",
                "To get started with GitHub CLI, please run:  gh auth login"
            ),
            "auth:gh"
        );
        assert_eq!(
            review_error(
                "glab",
                "GET https://gitlab.com/api/v4/user: 401 {message: 401 Unauthorized}"
            ),
            "auth:glab"
        );
        assert_eq!(
            review_error(
                "gh",
                "GraphQL: Could not resolve to a Repository with the name 'a/b'."
            ),
            "notfound"
        );
        assert_eq!(review_error("gh", "\nboom\nmore"), "failed:boom");
    }
}
