use super::FollowUps;
use std::fs;
use std::time::{SystemTime, UNIX_EPOCH};

fn test_store() -> (FollowUps, std::path::PathBuf) {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "agent-tally-followups-{}-{nonce}",
        std::process::id()
    ));
    let store = FollowUps::open(&dir.join("followups.sqlite")).unwrap();
    (store, dir)
}

#[test]
fn follow_ups_are_project_scoped_editable_and_persistent() {
    let (store, dir) = test_store();
    let created = store
        .save(
            None,
            "C:/work/app".into(),
            "app".into(),
            "Review the generated patch".into(),
            "Check edge cases".into(),
            "https://github.com/kasuken/AgentTally/pull/12".into(),
            false,
        )
        .unwrap();
    assert!(!created.done);
    assert_eq!(store.list().unwrap().len(), 1);

    let updated = store
        .save(
            Some(created.id),
            "C:/work/app".into(),
            "app".into(),
            "Review the generated patch".into(),
            "Checked edge cases".into(),
            String::new(),
            true,
        )
        .unwrap();
    assert_eq!(updated.id, created.id);
    assert!(updated.done);
    assert_eq!(updated.note, "Checked edge cases");

    drop(store);
    let reopened = FollowUps::open(&dir.join("followups.sqlite")).unwrap();
    let items = reopened.list().unwrap();
    assert_eq!(items.len(), 1);
    assert!(items[0].done);
    reopened.delete(created.id).unwrap();
    assert!(reopened.list().unwrap().is_empty());
    drop(reopened);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn follow_ups_reject_empty_titles_and_non_web_links() {
    let (store, dir) = test_store();
    assert!(store
        .save(
            None,
            "project".into(),
            "Project".into(),
            "  ".into(),
            String::new(),
            String::new(),
            false,
        )
        .unwrap_err()
        .contains("Title"));
    assert!(store
        .save(
            None,
            "project".into(),
            "Project".into(),
            "Do the work".into(),
            String::new(),
            "javascript:alert(1)".into(),
            false,
        )
        .unwrap_err()
        .contains("http"));
    drop(store);
    fs::remove_dir_all(dir).unwrap();
}
