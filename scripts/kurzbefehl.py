# Builds two shortcuts.
#
# "Budget Apple Pay", run by a Wallet automation after each Apple Pay payment: it sends merchant,
# amount and card to the inbox (eingang/), which encrypts them for the app. Without internet the
# payment waits in iCloud Drive/Shortcuts/Budget-Warteschlange.txt and goes along next time.
# The key is asked for when the shortcut is added (Budget › Einstellungen › Apple Pay).
#
# "Budget ablegen" for the share sheet. It takes the files Budget shares
# and saves them in iCloud Drive, in the Shortcuts folder:
#   budget-backup-….json  → Budget/Backups/
#   Budget_2026-10_….pdf / .xlsx / .csv → Budget/2026/   (the year from the file name)
# Existing files of the same name are replaced. At the end a notification says what was saved.
# Run: python3 scripts/kurzbefehl.py kurzbefehle, then for each "<Name> (unsigniert).shortcut"
#      shortcuts sign --mode anyone --input "kurzbefehle/<Name> (unsigniert).shortcut" --output "kurzbefehle/<Name>.shortcut"
#      and delete the unsigned files.
import plistlib
import sys
import uuid

OBJ = '￼'
new = lambda: str(uuid.uuid4()).upper()

REPEAT_ITEM = {'Type': 'Variable', 'VariableName': 'Repeat Item'}
NAME = {'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': 'Name'}


def token(text, attachments=None):
    return {'Value': {'string': text, 'attachmentsByRange': attachments or {}}, 'WFSerializationType': 'WFTextTokenString'}


def attachment(value):
    return {'Value': value, 'WFSerializationType': 'WFTextTokenAttachment'}


def action(identifier, **parameters):
    return {'WFWorkflowActionIdentifier': f'is.workflow.actions.{identifier}', 'WFWorkflowActionParameters': parameters}


def save(path):
    return action('documentpicker.save', WFInput=attachment(REPEAT_ITEM), WFAskWhereToSave=False, WFFileDestinationPath=path, WFSaveFileOverwrite=True)


def build(folder):
    repeat, branch = new(), new()
    match = new()
    item_name = dict(REPEAT_ITEM, Aggrandizements=[NAME])
    actions = [
        action('repeat.each', GroupingIdentifier=repeat, WFControlFlowMode=0, WFInput=attachment({'Type': 'ExtensionInput'})),
        # Backups go to Budget/Backups
        action('conditional', GroupingIdentifier=branch, WFControlFlowMode=0, WFCondition=99, WFConditionalActionString='budget-backup',
               WFInput={'Type': 'Variable', 'Variable': attachment(item_name)}),
        save(token('Budget/Backups/')),
        action('conditional', GroupingIdentifier=branch, WFControlFlowMode=1),
        # Statements go to Budget/<year>
        action('text.match', UUID=match, WFMatchTextPattern=r'\d{4}', WFMatchTextCaseSensitive=False, text=token(OBJ, {'{0, 1}': item_name})),
        save(token(f'Budget/{OBJ}/', {'{7, 1}': {'OutputName': 'Übereinstimmungen', 'OutputUUID': match, 'Type': 'ActionOutput'}})),
        action('conditional', GroupingIdentifier=branch, WFControlFlowMode=2, UUID=new()),
        action('repeat.each', GroupingIdentifier=repeat, WFControlFlowMode=2, UUID=new()),
        action('notification', WFNotificationActionTitle='Budget', WFNotificationActionBody='Abgelegt in iCloud Drive › Kurzbefehle › Budget', WFNotificationActionSound=False),
    ]
    shortcut = {
        'WFWorkflowClientVersion': '3218.0.4.100',
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconGlyphNumber': 59511, 'WFWorkflowIconStartColor': 463140863},
        'WFWorkflowImportQuestions': [],
        'WFWorkflowInputContentItemClasses': ['WFGenericFileContentItem'],
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowTypes': ['ActionExtension'],
        'WFWorkflowHasOutputFallback': False,
        'WFWorkflowHasShortcutInputVariables': True,
        'WFWorkflowActions': actions,
    }
    with open(f'{folder}/Budget ablegen (unsigniert).shortcut', 'wb') as f:
        plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)


EINGANG = 'https://budget-eingang.tankpreis-app.workers.dev/zahlung'
QUEUE = 'Budget-Warteschlange.txt'


def output(name, uid):
    return {'OutputName': name, 'OutputUUID': uid, 'Type': 'ActionOutput'}


def field(key, value):
    return {'WFItemType': 0, 'WFKey': token(key), 'WFValue': value}


def payment_input(prop=None):
    value = {'Type': 'ExtensionInput'}
    if prop:
        value['Aggrandizements'] = [{'Type': 'WFPropertyVariableAggrandizement', 'PropertyName': prop}]
    return token(OBJ, {'{0, 1}': value})


def build_apple_pay(folder):
    u_key, u_dict, u_file, u_all, u_res, u_ok, u_empty = (new() for _ in range(7))
    g_ok = new()
    actions = [
        action('gettext', UUID=u_key, WFTextActionText=''),
        # What the Wallet automation hands over about the payment; `roh` is the whole input, in case a property is empty
        action('dictionary', UUID=u_dict, WFItems={'Value': {'WFDictionaryFieldValueItems': [
            field('betrag', payment_input('Amount')),
            field('haendler', payment_input('Merchant')),
            field('karte', payment_input('Card or Pass')),
            field('name', payment_input('Name')),
            field('roh', payment_input()),
        ]}, 'WFSerializationType': 'WFDictionaryFieldValue'}),
        # Append to the queue, send all of it, empty it once the inbox has it
        action('documentpicker.open', UUID=u_file, WFGetFilePath=QUEUE, WFFileErrorIfNotFound=False, WFShowFilePicker=False),
        action('gettext', UUID=u_all, WFTextActionText=token(f'{OBJ}\n{OBJ}', {'{0, 1}': output('Datei', u_file), '{2, 1}': output('Wörterbuch', u_dict)})),
        action('documentpicker.save', WFInput=attachment(output('Text', u_all)), WFAskWhereToSave=False, WFFileDestinationPath=QUEUE, WFSaveFileOverwrite=True),
        action('downloadurl', UUID=u_res, WFURL=EINGANG, WFHTTPMethod='POST', ShowHeaders=True,
               WFHTTPHeaders={'Value': {'WFDictionaryFieldValueItems': [field('Authorization', token('Bearer ' + OBJ, {'{7, 1}': output('Text', u_key)}))]}, 'WFSerializationType': 'WFDictionaryFieldValue'},
               WFHTTPBodyType='JSON',
               WFJSONValues={'Value': {'WFDictionaryFieldValueItems': [field('text', token(OBJ, {'{0, 1}': output('Text', u_all)}))]}, 'WFSerializationType': 'WFDictionaryFieldValue'}),
        action('getvalueforkey', UUID=u_ok, WFDictionaryKey='gespeichert', WFGetDictionaryValueType='Value', WFInput=attachment(output('Inhalt von URL', u_res))),
        action('conditional', GroupingIdentifier=g_ok, WFControlFlowMode=0, WFCondition=100, WFInput={'Type': 'Variable', 'Variable': attachment(output('Wörterbuchwert', u_ok))}),
        action('gettext', UUID=u_empty, WFTextActionText=' '),
        action('documentpicker.save', WFInput=attachment(output('Text', u_empty)), WFAskWhereToSave=False, WFFileDestinationPath=QUEUE, WFSaveFileOverwrite=True),
        action('conditional', GroupingIdentifier=g_ok, WFControlFlowMode=2, UUID=new()),
    ]
    shortcut = {
        'WFWorkflowClientVersion': '3218.0.4.100',
        'WFWorkflowMinimumClientVersion': 900,
        'WFWorkflowMinimumClientVersionString': '900',
        'WFWorkflowIcon': {'WFWorkflowIconGlyphNumber': 59511, 'WFWorkflowIconStartColor': 463140863},
        'WFWorkflowImportQuestions': [{
            'ActionIndex': 0, 'Category': 'Parameter', 'DefaultValue': '', 'ParameterKey': 'WFTextActionText',
            'Text': 'Füge den Schlüssel ein: Budget › Einstellungen › Apple Pay › Schlüssel kopieren.'}],
        'WFWorkflowInputContentItemClasses': [],
        'WFWorkflowOutputContentItemClasses': [],
        'WFWorkflowTypes': [],
        'WFWorkflowHasOutputFallback': False,
        'WFWorkflowHasShortcutInputVariables': True,
        'WFWorkflowActions': actions,
    }
    with open(f'{folder}/Budget Apple Pay (unsigniert).shortcut', 'wb') as f:
        plistlib.dump(shortcut, f, fmt=plistlib.FMT_BINARY)


build(sys.argv[1])
build_apple_pay(sys.argv[1])
