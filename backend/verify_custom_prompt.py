#!/usr/bin/env python3
"""
Quick verification script for custom prompt functionality.
This script verifies the logic without requiring database or API setup.
"""

import sys
sys.path.insert(0, '.')

from app.services.test_generator import build_prompt


class MockDocument:
    """Mock document for testing"""
    def __init__(self, title: str, doc_type: str, content: str):
        self.title = title
        self.doc_type = doc_type
        self.content = content


def verify_custom_prompt_included():
    """Verify custom prompt is included when provided"""
    print("Test 1: Custom prompt WITH documents")
    docs = [MockDocument("Test Doc", "study_guide", "Test content here")]
    custom_prompt = "Focus on security scenarios"
    
    prompt = build_prompt(documents=docs, num_questions=5, num_choices=4, 
                         topic="AWS", custom_prompt=custom_prompt)
    
    assert "CUSTOM INSTRUCTIONS:" in prompt, "CUSTOM INSTRUCTIONS section missing!"
    assert custom_prompt in prompt, "Custom prompt text not found!"
    assert "STUDY MATERIALS:" in prompt, "STUDY MATERIALS section missing!"
    print("  ✅ PASS: Custom prompt included with documents")
    return True


def verify_custom_prompt_topic_based():
    """Verify custom prompt works for topic-based generation"""
    print("Test 2: Custom prompt WITHOUT documents (topic-based)")
    custom_prompt = "Make questions progressively harder"
    
    prompt = build_prompt(documents=[], num_questions=10, num_choices=4,
                         topic="Python", custom_prompt=custom_prompt)
    
    assert "CUSTOM INSTRUCTIONS:" in prompt, "CUSTOM INSTRUCTIONS section missing!"
    assert custom_prompt in prompt, "Custom prompt text not found!"
    assert "TOPIC: Python" in prompt, "TOPIC section missing!"
    print("  ✅ PASS: Custom prompt included for topic-based generation")
    return True


def verify_no_custom_prompt():
    """Verify default behavior when no custom prompt"""
    print("Test 3: NO custom prompt")
    prompt = build_prompt(documents=[], num_questions=5, num_choices=4,
                         topic="Docker", custom_prompt=None)
    
    assert "CUSTOM INSTRUCTIONS:" not in prompt, "CUSTOM INSTRUCTIONS should not be present!"
    assert "Include a mix of difficulty levels" in prompt, "Default instructions missing!"
    print("  ✅ PASS: Default prompt used when no custom prompt")
    return True


def verify_empty_string_handling():
    """Verify empty strings are treated as None"""
    print("Test 4: Empty string custom prompt")
    prompt = build_prompt(documents=[], num_questions=5, num_choices=4,
                         topic="Kubernetes", custom_prompt="")
    
    assert "CUSTOM INSTRUCTIONS:" not in prompt, "Empty string should be treated as None!"
    print("  ✅ PASS: Empty string correctly normalized to None")
    return True


def verify_whitespace_only_handling():
    """Verify whitespace-only strings are treated as None"""
    print("Test 5: Whitespace-only custom prompt")
    prompt = build_prompt(documents=[], num_questions=5, num_choices=4,
                         topic="React", custom_prompt="   \n\t  ")
    
    assert "CUSTOM INSTRUCTIONS:" not in prompt, "Whitespace-only should be treated as None!"
    print("  ✅ PASS: Whitespace-only string correctly normalized to None")
    return True


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("CUSTOM PROMPT VERIFICATION")
    print("=" * 60 + "\n")
    
    tests = [
        verify_custom_prompt_included,
        verify_custom_prompt_topic_based,
        verify_no_custom_prompt,
        verify_empty_string_handling,
        verify_whitespace_only_handling,
    ]
    
    passed = 0
    failed = 0
    
    for test in tests:
        try:
            test()
            passed += 1
        except AssertionError as e:
            print(f"  ❌ FAIL: {e}")
            failed += 1
        except Exception as e:
            print(f"  ❌ ERROR: {e}")
            failed += 1
        print()
    
    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60 + "\n")
    
    sys.exit(0 if failed == 0 else 1)
