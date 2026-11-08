"""Add CC0 Quaternius swim clips and local gallop/flight derivatives to our mannequin.
Usage: python3 scripts/build-character-movement.py /path/to/UAL1_Standard.glb
"""
import copy
import json
import math
from pathlib import Path
import struct
import sys


def load(path):
    data = Path(path).read_bytes()
    size = struct.unpack_from('<I', data, 12)[0]
    return json.loads(data[20:20 + size]), bytearray(data[28 + size:])


path = Path('public/models/character.glb')
target, binary = load(path)
source, source_binary = load(sys.argv[1])
nodes = {node['name']: i for i, node in enumerate(target['nodes'])}
components = {'SCALAR': 1, 'VEC3': 3, 'VEC4': 4}


def read(index):
    accessor = source['accessors'][index]
    assert accessor['componentType'] == 5126
    view = source['bufferViews'][accessor['bufferView']]
    width = components[accessor['type']]
    offset = view.get('byteOffset', 0) + accessor.get('byteOffset', 0)
    return [list(struct.unpack_from('<' + 'f' * width, source_binary, offset + i * width * 4)) for i in range(accessor['count'])]


def write(values, kind):
    while len(binary) % 4:
        binary.append(0)
    offset = len(binary)
    for value in values:
        binary.extend(struct.pack('<' + 'f' * len(value), *value))
    view = len(target['bufferViews'])
    target['bufferViews'].append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(binary) - offset})
    accessor = {'bufferView': view, 'componentType': 5126, 'count': len(values), 'type': kind}
    if kind == 'SCALAR':
        accessor.update(min=[min(v[0] for v in values)], max=[max(v[0] for v in values)])
    target['accessors'].append(accessor)
    return len(target['accessors']) - 1


names = ['Swim_Fwd_Loop', 'Swim_Idle_Loop', 'Jump_Land', 'Gallop_Loop', 'Fly_Loop', 'Fly_Idle_Loop']
target['animations'] = [a for a in target['animations'] if a['name'] not in names]
for name in names:
    original = {'Gallop_Loop': 'Sprint_Loop', 'Fly_Loop': 'Swim_Fwd_Loop', 'Fly_Idle_Loop': 'Swim_Idle_Loop'}.get(name, name)
    animation = next(a for a in source['animations'] if a['name'] == original)
    result = {'name': name, 'channels': [], 'samplers': []}
    jump_pose = next(a for a in source['animations'] if a['name'] == 'Jump_Loop')
    by_name = {(source['nodes'][c['target']['node']]['name'], c['target']['path']): c for c in animation['channels']}
    for channel in animation['channels']:
        node = source['nodes'][channel['target']['node']]['name']
        prop = channel['target']['path']
        sampler = animation['samplers'][channel['sampler']]
        times, values = read(sampler['input']), read(sampler['output'])
        if name == 'Gallop_Loop':
            times = [[t[0] / 1.35] for t in times]
        if name.startswith('Fly_'):
            # Freeze a swimming pose; mirror the extended arm for a two-arm flight silhouette.
            if name == 'Fly_Loop' and node.endswith('_r') and node.startswith(('upperarm', 'lowerarm', 'hand')):
                other = by_name[(node[:-2] + '_l', prop)]
                values = read(animation['samplers'][other['sampler']]['output'])
                if prop == 'rotation':
                    values = [[v[0], -v[1], -v[2], v[3]] for v in values]
                elif prop == 'translation':
                    values = [[-v[0], v[1], v[2]] for v in values]
            passive = values
            value = values[round((len(values) - 1) * (.375 if name == 'Fly_Loop' else .25))]
            if name == 'Fly_Idle_Loop' and prop == 'rotation' and node.startswith('upperarm_'):
                idle = next(a for a in source['animations'] if a['name'] == 'Idle_Loop')
                idle_channel = next(c for c in idle['channels'] if c['target'] == channel['target'])
                resting = read(idle['samplers'][idle_channel['sampler']]['output'])[0]
                if sum(a * b for a, b in zip(value, resting)) < 0:
                    resting = [-a for a in resting]
                value = [(a + 2 * b) / 3 for a, b in zip(value, resting)]
                norm = math.sqrt(sum(a * a for a in value))
                value = [a / norm for a in value]
            if name == 'Fly_Idle_Loop' and node.startswith(('thigh_', 'calf_', 'foot_', 'ball_')):
                jump_channel = next(c for c in jump_pose['channels'] if c['target'] == channel['target'])
                jump_values = read(jump_pose['samplers'][jump_channel['sampler']]['output'])
                value = jump_values[len(jump_values) // 2][:]
                if prop == 'translation' and node.startswith('thigh_'):
                    value[0] *= .6
            times = [[i / 15] for i in range(31)]
            values = [value[:] for _ in times]
            if name == 'Fly_Idle_Loop' and prop == 'rotation':
                # Keep the authored pose, adding only 12% of the water-idle motion around it.
                reference = passive[0]
                passive = [v if sum(a * b for a, b in zip(v, reference)) >= 0 else [-a for a in v] for v in passive]
                mean = [sum(v[k] for v in passive) / len(passive) for k in range(4)]
                for i, v in enumerate(values):
                    position = i * (len(passive) - 1) / (len(values) - 1)
                    start = int(position)
                    end = min(start + 1, len(passive) - 1)
                    fraction = position - start
                    v[:] = [value[k] + .12 * (passive[start][k] * (1 - fraction) + passive[end][k] * fraction - mean[k]) for k in range(4)]
                    norm = math.sqrt(sum(a * a for a in v))
                    v[:] = [a / norm for a in v]
                values[-1] = values[0][:]
            if node == 'pelvis' and prop == 'translation':
                for t, v in zip(times, values):
                    v[2] += .025 * math.sin(t[0] * math.pi)
        if node == 'pelvis' and prop == 'translation':
            # Pack swim clips use the waterline as origin; the controller uses feet.
            lift = .9 if name == 'Fly_Loop' else 1.35 if name.startswith(('Swim_', 'Fly_')) else 0
            values = [[v[0], v[1], v[2] + lift] for v in values]
        result['channels'].append({'sampler': len(result['samplers']), 'target': {'node': nodes[node], 'path': prop}})
        result['samplers'].append({'input': write(times, 'SCALAR'), 'output': write(values, source['accessors'][sampler['output']]['type']), 'interpolation': 'LINEAR'})
    target['animations'].append(result)

# Discard orphaned old buffers on repeated builds.
used = {s[key] for a in target['animations'] for s in a['samplers'] for key in ['input', 'output']}
used |= {value for mesh in target['meshes'] for primitive in mesh['primitives'] for value in [*primitive['attributes'].values(), primitive['indices']]}
used |= {skin['inverseBindMatrices'] for skin in target['skins']}
accessors, views, compact = [], [], bytearray()
remap = {}
for index in sorted(used):
    accessor = copy.deepcopy(target['accessors'][index])
    view = target['bufferViews'][accessor['bufferView']]
    offset = view.get('byteOffset', 0) + accessor.pop('byteOffset', 0)
    width = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[accessor['type']] * {5126: 4, 5125: 4, 5123: 2, 5121: 1}[accessor['componentType']]
    length = accessor['count'] * width
    while len(compact) % 4:
        compact.append(0)
    accessor['bufferView'] = len(views)
    views.append({'buffer': 0, 'byteOffset': len(compact), 'byteLength': length})
    stride = view.get('byteStride', width)
    for i in range(accessor['count']):
        compact.extend(binary[offset + i * stride:offset + i * stride + width])
    remap[index] = len(accessors)
    accessors.append(accessor)
for animation in target['animations']:
    for sampler in animation['samplers']:
        for key in ['input', 'output']:
            sampler[key] = remap[sampler[key]]
for mesh in target['meshes']:
    for primitive in mesh['primitives']:
        primitive['attributes'] = {key: remap[value] for key, value in primitive['attributes'].items()}
        primitive['indices'] = remap[primitive['indices']]
for skin in target['skins']:
    skin['inverseBindMatrices'] = remap[skin['inverseBindMatrices']]
target['accessors'], target['bufferViews'] = accessors, views
target['buffers'] = [{'byteLength': len(compact)}]
encoded = json.dumps(target, separators=(',', ':')).encode()
encoded += b' ' * (-len(encoded) % 4)
compact += b'\0' * (-len(compact) % 4)
path.write_bytes(struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(compact)) + struct.pack('<II', len(encoded), 0x4E4F534A) + encoded + struct.pack('<II', len(compact), 0x004E4942) + compact)
print(path, path.stat().st_size, 'bytes')
