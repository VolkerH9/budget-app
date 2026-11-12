# Builds the shortcut "Budget ablegen" for the share sheet. It takes the files Budget shares
# and saves them in iCloud Drive, in the Shortcuts folder:
#   budget-backup-….json  → Budget/Backups/
#   Budget_2026-10_….pdf / .xlsx / .csv → Budget/2026/   (the year from the file name)
# Existing files of the same name are replaced. At the end a notification says what was saved.
# Run: python3 scripts/kurzbefehl.py kurzbefehle, then
#      shortcuts sign --mode anyone --input "kurzbefehle/Budget ablegen (unsigniert).shortcut" --output "kurzbefehle/Budget ablegen.shortcut"
#      and delete the unsigned file.
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


build(sys.argv[1])
