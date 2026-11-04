"""Invalid AI answer keys must never become valid learning answers."""
import json

import pytest

from app.services.test_generator import parse_questions_response


@pytest.mark.parametrize('key', [None, -1, 'unknown', True, 0.8, -0.5, float('nan'), float('inf')])
@pytest.mark.parametrize('fallback', [False, True])
def test_unusable_answer_keys_are_rejected(key, fallback):
    question = {'question': 'Two plus two?', 'choices': ['3', '4', '5', '6']}
    if key is not None:
        question['correct_answer'] = key
    content = json.dumps([question])
    if fallback:
        content = content[:-1] + ',]'
    with pytest.raises(ValueError):
        parse_questions_response(content, 4)


@pytest.mark.parametrize('fallback', [False, True])
@pytest.mark.parametrize('key', [1, 1.0, '1', 'b', 'B'])
def test_answer_mapping_survives_single_letter_options(key, fallback):
    content = json.dumps([{'question': 'Which?', 'choices': ['A', 'Beta', 'Cee', 'Dee'], 'correct_answer': key}])
    if fallback:
        content = content[:-1] + ',]'
    question = parse_questions_response(content, 4)[0]
    assert question['choices'] == ['A', 'Beta', 'Cee', 'Dee']
    assert question['choices'][question['correct_answer']] == 'Beta'


def test_invented_options_cannot_be_the_correct_answer():
    content = json.dumps([{'question': 'Q', 'choices': ['one', 'two'], 'correct_answer': 3}])
    with pytest.raises(ValueError):
        parse_questions_response(content, 4)


