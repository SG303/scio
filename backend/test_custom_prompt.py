"""
Test script to verify custom prompt functionality in test templates.
Run with: python test_custom_prompt.py
"""

import sys
sys.path.insert(0, '.')

from app.services.test_generator import build_prompt
from app.models import Document


class MockDocument:
    """Mock document for testing"""
    def __init__(self, title: str, doc_type: str, content: str):
        self.title = title
        self.doc_type = doc_type
        self.content = content


def test_custom_prompt_with_documents():
    """Test that custom prompt is included when documents are provided"""
    print("=" * 60)
    print("TEST 1: Custom prompt WITH documents")
    print("=" * 60)
    
    # Create mock documents
    docs = [
        MockDocument(
            title="AWS Study Guide",
            doc_type="study_guide",
            content="AWS EC2 is a web service that provides resizable compute capacity..."
        )
    ]
    
    custom_prompt = "Focus on scenario-based questions about security best practices"
    
    prompt = build_prompt(
        documents=docs,
        num_questions=5,
        num_choices=4,
        topic="AWS",
        custom_prompt=custom_prompt
    )
    
    # Verify custom prompt is included
    assert "CUSTOM INSTRUCTIONS:" in prompt, "CUSTOM INSTRUCTIONS section missing!"
    assert custom_prompt in prompt, "Custom prompt text not found in generated prompt!"
    assert "STUDY MATERIALS:" in prompt, "STUDY MATERIALS section missing!"
    
    print("✅ Custom prompt IS included in the generated prompt")
    print("\n--- Generated Prompt Preview ---")
    print(prompt[:800] + "...\n")
    
    return True


def test_custom_prompt_without_documents():
    """Test that custom prompt is included for topic-based generation"""
    print("=" * 60)
    print("TEST 2: Custom prompt WITHOUT documents (topic-based)")
    print("=" * 60)
    
    custom_prompt = "Make questions progressively harder and include real-world scenarios"
    
    prompt = build_prompt(
        documents=[],
        num_questions=10,
        num_choices=4,
        topic="Python Programming",
        custom_prompt=custom_prompt
    )
    
    # Verify custom prompt is included
    assert "CUSTOM INSTRUCTIONS:" in prompt, "CUSTOM INSTRUCTIONS section missing!"
    assert custom_prompt in prompt, "Custom prompt text not found in generated prompt!"
    assert "TOPIC: Python Programming" in prompt, "TOPIC section missing!"
    
    print("✅ Custom prompt IS included in the generated prompt")
    print("\n--- Generated Prompt Preview ---")
    print(prompt[:800] + "...\n")
    
    return True


def test_no_custom_prompt_with_documents():
    """Test default behavior when no custom prompt is provided (with documents)"""
    print("=" * 60)
    print("TEST 3: NO custom prompt with documents (default behavior)")
    print("=" * 60)
    
    docs = [
        MockDocument(
            title="Kubernetes Guide",
            doc_type="study_guide",
            content="Kubernetes is a container orchestration platform..."
        )
    ]
    
    prompt = build_prompt(
        documents=docs,
        num_questions=5,
        num_choices=4,
        topic="Kubernetes",
        custom_prompt=None  # No custom prompt
    )
    
    # Verify custom instructions section is NOT present
    assert "CUSTOM INSTRUCTIONS:" not in prompt, "CUSTOM INSTRUCTIONS should NOT be present!"
    assert "Questions should test understanding, not just memorization" in prompt, "Default instructions missing!"
    
    print("✅ Default prompt is used (no CUSTOM INSTRUCTIONS section)")
    print("\n--- Generated Prompt Preview ---")
    print(prompt[:800] + "...\n")
    
    return True


def test_no_custom_prompt_without_documents():
    """Test default behavior when no custom prompt is provided (topic-based)"""
    print("=" * 60)
    print("TEST 4: NO custom prompt without documents (topic-based default)")
    print("=" * 60)
    
    prompt = build_prompt(
        documents=[],
        num_questions=10,
        num_choices=4,
        topic="Machine Learning",
        custom_prompt=None  # No custom prompt
    )
    
    # Verify custom instructions section is NOT present
    assert "CUSTOM INSTRUCTIONS:" not in prompt, "CUSTOM INSTRUCTIONS should NOT be present!"
    assert "Include a mix of difficulty levels" in prompt, "Default instructions missing!"
    
    print("✅ Default prompt is used (no CUSTOM INSTRUCTIONS section)")
    print("\n--- Generated Prompt Preview ---")
    print(prompt[:800] + "...\n")
    
    return True


def test_empty_string_custom_prompt():
    """Test that empty string custom prompt behaves like None"""
    print("=" * 60)
    print("TEST 5: Empty string custom prompt (should behave like None)")
    print("=" * 60)
    
    prompt = build_prompt(
        documents=[],
        num_questions=5,
        num_choices=4,
        topic="Docker",
        custom_prompt=""  # Empty string
    )
    
    # Empty string is falsy, so it should use default prompt
    # Note: This depends on implementation - checking current behavior
    if "CUSTOM INSTRUCTIONS:" in prompt:
        print("⚠️  Empty string IS treated as a custom prompt (may want to handle this)")
        print("    Consider converting empty strings to None in the frontend/backend")
    else:
        print("✅ Empty string correctly treated as no custom prompt")
    
    print("\n--- Generated Prompt Preview ---")
    print(prompt[:500] + "...\n")
    
    return True


def main():
    """Run all tests"""
    print("\n" + "=" * 60)
    print("CUSTOM PROMPT VERIFICATION TESTS")
    print("=" * 60 + "\n")
    
    tests = [
        ("Custom prompt WITH documents", test_custom_prompt_with_documents),
        ("Custom prompt WITHOUT documents", test_custom_prompt_without_documents),
        ("NO custom prompt with documents", test_no_custom_prompt_with_documents),
        ("NO custom prompt without documents", test_no_custom_prompt_without_documents),
        ("Empty string custom prompt", test_empty_string_custom_prompt),
    ]
    
    results = []
    for name, test_fn in tests:
        try:
            test_fn()
            results.append((name, True, None))
        except AssertionError as e:
            results.append((name, False, str(e)))
            print(f"❌ FAILED: {e}\n")
        except Exception as e:
            results.append((name, False, str(e)))
            print(f"❌ ERROR: {e}\n")
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for _, success, _ in results if success)
    total = len(results)
    
    for name, success, error in results:
        status = "✅ PASS" if success else f"❌ FAIL: {error}"
        print(f"  {name}: {status}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    print("=" * 60 + "\n")
    
    return passed == total


if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)



