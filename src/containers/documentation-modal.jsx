import PropTypes from 'prop-types';
import React from 'react';
import {connect} from 'react-redux';
import {closeDocumentationModal} from '../reducers/modals';
import DocumentationModalComponent from '../components/documentation-modal/documentation-modal.jsx';

const DocumentationModal = props => (
    <DocumentationModalComponent
        onClose={props.onClose}
        projectTitle={props.projectTitle}
        vm={props.vm}
    />
);

DocumentationModal.propTypes = {
    onClose: PropTypes.func.isRequired,
    projectTitle: PropTypes.string,
    vm: PropTypes.shape({
        runtime: PropTypes.shape({
            targets: PropTypes.array
        })
    })
};

const mapStateToProps = state => ({
    projectTitle: state.scratchGui.projectTitle,
    vm: state.scratchGui.vm
});

const mapDispatchToProps = dispatch => ({
    onClose: () => dispatch(closeDocumentationModal())
});

export default connect(
    mapStateToProps,
    mapDispatchToProps
)(DocumentationModal);
